/**
 * M4A Track Extractor
 * Extract individual audio tracks from multi-track M4A/MP4 files
 * without requiring FFmpeg
 */

import fs from 'fs/promises';

/**
 * Parse MP4 atoms from buffer (same as in atoms.js but exported here for self-containment)
 * @param {Buffer} buffer - File buffer
 * @param {number} offset - Start offset
 * @param {number} maxLength - Maximum length to parse
 * @returns {Array} Array of atom objects
 */
function parseAtoms(buffer, offset = 0, maxLength = null) {
  const atoms = [];
  const endOffset = maxLength ? offset + maxLength : buffer.length;
  let pos = offset;

  while (pos < endOffset - 8) {
    const size = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);

    if (size === 0 || size < 8 || size > buffer.length - pos) {
      break;
    }

    atoms.push({
      type,
      offset: pos,
      size,
      dataOffset: pos + 8,
    });

    pos += size;
  }

  return atoms;
}

/**
 * Find an atom by type within a list
 * @param {Array} atoms - Array of atom objects
 * @param {string} type - Atom type to find
 * @returns {Object|null} Found atom or null
 */
function findAtom(atoms, type) {
  return atoms.find((a) => a.type === type) || null;
}

/**
 * Parse stco (32-bit chunk offset) atom
 * @param {Buffer} buffer - File buffer
 * @param {Object} atom - stco atom object
 * @returns {Array<number>} Array of chunk offsets
 */
function parseStco(buffer, atom) {
  const offsets = [];
  // stco: 4 bytes version/flags + 4 bytes entry count + entries
  const entryCount = buffer.readUInt32BE(atom.dataOffset + 4);

  for (let i = 0; i < entryCount; i++) {
    const offset = buffer.readUInt32BE(atom.dataOffset + 8 + i * 4);
    offsets.push(offset);
  }

  return offsets;
}

/**
 * Parse co64 (64-bit chunk offset) atom
 * @param {Buffer} buffer - File buffer
 * @param {Object} atom - co64 atom object
 * @returns {Array<number>} Array of chunk offsets
 */
function parseCo64(buffer, atom) {
  const offsets = [];
  const entryCount = buffer.readUInt32BE(atom.dataOffset + 4);

  for (let i = 0; i < entryCount; i++) {
    const offset = Number(buffer.readBigUInt64BE(atom.dataOffset + 8 + i * 8));
    offsets.push(offset);
  }

  return offsets;
}

/**
 * Parse stsz (sample sizes) atom
 * @param {Buffer} buffer - File buffer
 * @param {Object} atom - stsz atom object
 * @returns {Object} { defaultSize, sizes } - If defaultSize > 0, all samples are that size
 */
function parseStsz(buffer, atom) {
  // stsz: 4 bytes version/flags + 4 bytes sample_size + 4 bytes sample_count + entries
  const defaultSize = buffer.readUInt32BE(atom.dataOffset + 4);
  const sampleCount = buffer.readUInt32BE(atom.dataOffset + 8);

  if (defaultSize > 0) {
    // All samples have the same size
    return { defaultSize, sampleCount, sizes: null };
  }

  // Variable sample sizes
  const sizes = [];
  for (let i = 0; i < sampleCount; i++) {
    const size = buffer.readUInt32BE(atom.dataOffset + 12 + i * 4);
    sizes.push(size);
  }

  return { defaultSize: 0, sampleCount, sizes };
}

/**
 * Parse stsc (sample-to-chunk) atom
 * @param {Buffer} buffer - File buffer
 * @param {Object} atom - stsc atom object
 * @returns {Array} Array of { firstChunk, samplesPerChunk, sampleDescriptionIndex }
 */
function parseStsc(buffer, atom) {
  // stsc: 4 bytes version/flags + 4 bytes entry count + entries
  const entryCount = buffer.readUInt32BE(atom.dataOffset + 4);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = atom.dataOffset + 8 + i * 12;
    entries.push({
      firstChunk: buffer.readUInt32BE(entryOffset), // 1-based
      samplesPerChunk: buffer.readUInt32BE(entryOffset + 4),
      sampleDescriptionIndex: buffer.readUInt32BE(entryOffset + 8),
    });
  }

  return entries;
}

/**
 * Parse stsd (sample description) atom - returns raw bytes for codec config
 * @param {Buffer} buffer - File buffer
 * @param {Object} atom - stsd atom object
 * @returns {Buffer} Raw stsd atom data (including header)
 */
function parseStsd(buffer, atom) {
  // Return the entire stsd atom as-is for inclusion in output file
  return buffer.slice(atom.offset, atom.offset + atom.size);
}

/**
 * Parse stts (time-to-sample) atom
 * @param {Buffer} buffer - File buffer
 * @param {Object} atom - stts atom object
 * @returns {Array} Array of { sampleCount, sampleDelta }
 */
function parseStts(buffer, atom) {
  const entryCount = buffer.readUInt32BE(atom.dataOffset + 4);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = atom.dataOffset + 8 + i * 8;
    entries.push({
      sampleCount: buffer.readUInt32BE(entryOffset),
      sampleDelta: buffer.readUInt32BE(entryOffset + 4),
    });
  }

  return entries;
}

/**
 * Parse mdhd (media header) atom for timescale and duration
 * @param {Buffer} buffer - File buffer
 * @param {Object} atom - mdhd atom object
 * @returns {Object} { timescale, duration }
 */
function parseMdhd(buffer, atom) {
  const version = buffer.readUInt8(atom.dataOffset);

  if (version === 0) {
    // 32-bit version
    return {
      timescale: buffer.readUInt32BE(atom.dataOffset + 12),
      duration: buffer.readUInt32BE(atom.dataOffset + 16),
    };
  } else {
    // 64-bit version
    return {
      timescale: buffer.readUInt32BE(atom.dataOffset + 20),
      duration: Number(buffer.readBigUInt64BE(atom.dataOffset + 24)),
    };
  }
}

/**
 * Build sample map from stsc entries
 * Maps each chunk to its sample range
 * @param {Array} stscEntries - Parsed stsc entries
 * @param {number} totalChunks - Total number of chunks from stco
 * @returns {Array} Array of { chunkIndex, sampleStart, sampleCount } for each chunk
 */
function buildChunkSampleMap(stscEntries, totalChunks) {
  const chunkMap = [];
  let currentSampleIndex = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    // Find which stsc entry applies to this chunk (1-based in stsc)
    const chunkNumber = chunkIndex + 1;
    let samplesPerChunk = stscEntries[0].samplesPerChunk;

    for (let i = stscEntries.length - 1; i >= 0; i--) {
      if (chunkNumber >= stscEntries[i].firstChunk) {
        samplesPerChunk = stscEntries[i].samplesPerChunk;
        break;
      }
    }

    chunkMap.push({
      chunkIndex,
      sampleStart: currentSampleIndex,
      sampleCount: samplesPerChunk,
    });

    currentSampleIndex += samplesPerChunk;
  }

  return chunkMap;
}

/**
 * Extract raw audio data for a track
 * @param {Buffer} fileBuffer - Complete file buffer
 * @param {Object} sampleTable - Parsed sample table { stco, stsz, stsc }
 * @returns {Buffer} Raw audio sample data
 */
function extractAudioData(fileBuffer, sampleTable) {
  const { chunkOffsets, sampleSizes, stscEntries } = sampleTable;
  const chunkMap = buildChunkSampleMap(stscEntries, chunkOffsets.length);

  // Calculate total size needed
  let totalSize = 0;
  if (sampleSizes.sizes) {
    totalSize = sampleSizes.sizes.reduce((sum, size) => sum + size, 0);
  } else {
    totalSize = sampleSizes.sampleCount * sampleSizes.defaultSize;
  }

  // Allocate output buffer
  const audioData = Buffer.alloc(totalSize);
  let writeOffset = 0;

  // Extract samples from each chunk
  for (const chunk of chunkMap) {
    let readOffset = chunkOffsets[chunk.chunkIndex];

    for (let i = 0; i < chunk.sampleCount; i++) {
      const sampleIndex = chunk.sampleStart + i;
      const sampleSize = sampleSizes.sizes
        ? sampleSizes.sizes[sampleIndex]
        : sampleSizes.defaultSize;

      // Copy sample data
      fileBuffer.copy(audioData, writeOffset, readOffset, readOffset + sampleSize);
      writeOffset += sampleSize;
      readOffset += sampleSize;
    }
  }

  return audioData;
}

/**
 * Create a minimal MP4 atom
 * @param {string} type - 4-character atom type
 * @param {Buffer} data - Atom payload
 * @returns {Buffer} Complete atom with header
 */
function createAtom(type, data) {
  const size = 8 + data.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, data]);
}

/**
 * Build a minimal playable M4A file from extracted track data
 * @param {Object} trackInfo - Track information
 * @param {Buffer} trackInfo.audioData - Raw audio sample data
 * @param {Buffer} trackInfo.stsd - Original stsd atom
 * @param {Object} trackInfo.sampleSizes - Parsed stsz data
 * @param {Array} trackInfo.sttsEntries - Parsed stts entries
 * @param {Object} trackInfo.mdhd - Parsed mdhd data
 * @returns {Buffer} Complete M4A file
 */
function buildM4aFile(trackInfo) {
  const { audioData, stsd, sampleSizes, sttsEntries, mdhd } = trackInfo;

  // Build ftyp
  const ftypData = Buffer.from([
    0x4d, 0x34, 0x41, 0x20, // major_brand: 'M4A '
    0x00, 0x00, 0x00, 0x00, // minor_version: 0
    0x4d, 0x34, 0x41, 0x20, // compatible_brand: 'M4A '
    0x6d, 0x70, 0x34, 0x32, // compatible_brand: 'mp42'
    0x69, 0x73, 0x6f, 0x6d, // compatible_brand: 'isom'
  ]);
  const ftyp = createAtom('ftyp', ftypData);

  // Build stts (time-to-sample)
  const sttsData = Buffer.alloc(8 + sttsEntries.length * 8);
  sttsData.writeUInt32BE(0, 0); // version/flags
  sttsData.writeUInt32BE(sttsEntries.length, 4);
  for (let i = 0; i < sttsEntries.length; i++) {
    sttsData.writeUInt32BE(sttsEntries[i].sampleCount, 8 + i * 8);
    sttsData.writeUInt32BE(sttsEntries[i].sampleDelta, 8 + i * 8 + 4);
  }
  const stts = createAtom('stts', sttsData);

  // Build stsc (sample-to-chunk) - all samples in one chunk
  const stscData = Buffer.alloc(8 + 12);
  stscData.writeUInt32BE(0, 0); // version/flags
  stscData.writeUInt32BE(1, 4); // entry count
  stscData.writeUInt32BE(1, 8); // first chunk (1-based)
  stscData.writeUInt32BE(sampleSizes.sampleCount, 12); // samples per chunk
  stscData.writeUInt32BE(1, 16); // sample description index
  const stsc = createAtom('stsc', stscData);

  // Build stsz (sample sizes)
  let stsz;
  if (sampleSizes.defaultSize > 0) {
    // Fixed size samples
    const stszData = Buffer.alloc(12);
    stszData.writeUInt32BE(0, 0); // version/flags
    stszData.writeUInt32BE(sampleSizes.defaultSize, 4);
    stszData.writeUInt32BE(sampleSizes.sampleCount, 8);
    stsz = createAtom('stsz', stszData);
  } else {
    // Variable size samples
    const stszData = Buffer.alloc(12 + sampleSizes.sizes.length * 4);
    stszData.writeUInt32BE(0, 0); // version/flags
    stszData.writeUInt32BE(0, 4); // default size = 0
    stszData.writeUInt32BE(sampleSizes.sizes.length, 8);
    for (let i = 0; i < sampleSizes.sizes.length; i++) {
      stszData.writeUInt32BE(sampleSizes.sizes[i], 12 + i * 4);
    }
    stsz = createAtom('stsz', stszData);
  }

  // Placeholder for stco - will update after we know moov size
  const stcoData = Buffer.alloc(12);
  stcoData.writeUInt32BE(0, 0); // version/flags
  stcoData.writeUInt32BE(1, 4); // entry count = 1 chunk
  // stcoData[8-11] = chunk offset, will be filled in later
  const stco = createAtom('stco', stcoData);

  // Build stbl (sample table)
  const stbl = createAtom('stbl', Buffer.concat([stsd, stts, stsc, stsz, stco]));

  // Build dinf with dref
  const drefData = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // version/flags
    0x00, 0x00, 0x00, 0x01, // entry count = 1
    0x00, 0x00, 0x00, 0x0c, // url atom size = 12
    0x75, 0x72, 0x6c, 0x20, // 'url '
    0x00, 0x00, 0x00, 0x01, // flags = self-contained
  ]);
  const dref = createAtom('dref', drefData);
  const dinf = createAtom('dinf', dref);

  // Build smhd (sound media header)
  const smhdData = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // version/flags
    0x00, 0x00, // balance
    0x00, 0x00, // reserved
  ]);
  const smhd = createAtom('smhd', smhdData);

  // Build minf
  const minf = createAtom('minf', Buffer.concat([smhd, dinf, stbl]));

  // Build hdlr for mdia
  const hdlrData = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // version/flags
    0x00, 0x00, 0x00, 0x00, // pre-defined
    0x73, 0x6f, 0x75, 0x6e, // handler_type: 'soun'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, // name (empty string)
  ]);
  const hdlr = createAtom('hdlr', hdlrData);

  // Build mdhd (media header)
  const mdhdData = Buffer.alloc(24);
  mdhdData.writeUInt32BE(0, 0); // version/flags (version 0)
  mdhdData.writeUInt32BE(0, 4); // creation_time
  mdhdData.writeUInt32BE(0, 8); // modification_time
  mdhdData.writeUInt32BE(mdhd.timescale, 12); // timescale
  mdhdData.writeUInt32BE(mdhd.duration, 16); // duration
  mdhdData.writeUInt16BE(0x55c4, 20); // language: 'und'
  mdhdData.writeUInt16BE(0, 22); // quality
  const mdhdAtom = createAtom('mdhd', mdhdData);

  // Build mdia
  const mdia = createAtom('mdia', Buffer.concat([mdhdAtom, hdlr, minf]));

  // Build tkhd (track header)
  const tkhdData = Buffer.alloc(84);
  tkhdData.writeUInt8(0, 0); // version
  tkhdData.writeUInt8(0, 1); // flags[0]
  tkhdData.writeUInt8(0, 2); // flags[1]
  tkhdData.writeUInt8(0x07, 3); // flags[2] = enabled + in_movie + in_preview
  // creation_time, modification_time = 0
  tkhdData.writeUInt32BE(1, 12); // track_id
  // reserved = 0
  tkhdData.writeUInt32BE(mdhd.duration, 20); // duration (in movie timescale)
  // remaining fields are zero (no video dimensions, etc.)
  tkhdData.writeUInt32BE(0x00010000, 76); // volume = 1.0 (fixed point)
  const tkhd = createAtom('tkhd', tkhdData);

  // Build trak
  const trak = createAtom('trak', Buffer.concat([tkhd, mdia]));

  // Build mvhd (movie header)
  const mvhdData = Buffer.alloc(100);
  mvhdData.writeUInt32BE(0, 0); // version/flags
  // creation/modification times = 0
  mvhdData.writeUInt32BE(mdhd.timescale, 12); // timescale
  mvhdData.writeUInt32BE(mdhd.duration, 16); // duration
  mvhdData.writeUInt32BE(0x00010000, 20); // rate = 1.0
  mvhdData.writeUInt16BE(0x0100, 24); // volume = 1.0
  // reserved = 0
  // matrix (identity): 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000
  mvhdData.writeUInt32BE(0x00010000, 36);
  mvhdData.writeUInt32BE(0x00010000, 52);
  mvhdData.writeUInt32BE(0x40000000, 68);
  mvhdData.writeUInt32BE(2, 96); // next_track_id
  const mvhd = createAtom('mvhd', mvhdData);

  // Build moov
  const moov = createAtom('moov', Buffer.concat([mvhd, trak]));

  // Build mdat
  const mdat = createAtom('mdat', audioData);

  // Calculate actual chunk offset (ftyp + moov size)
  const chunkOffset = ftyp.length + moov.length + 8; // +8 for mdat header
  moov.writeUInt32BE(chunkOffset, moov.length - stco.length + 8 + 8);

  return Buffer.concat([ftyp, moov, mdat]);
}

/**
 * Find a trak atom by index
 * @param {Buffer} buffer - File buffer
 * @param {number} trackIndex - Track index (0-based)
 * @returns {Object|null} Track info or null
 */
function findTrack(buffer, trackIndex) {
  const atoms = parseAtoms(buffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) return null;

  const moovChildren = parseAtoms(buffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  if (trackIndex >= traks.length) return null;

  return traks[trackIndex];
}

/**
 * Parse sample table from a trak atom
 * @param {Buffer} buffer - File buffer
 * @param {Object} trak - trak atom object
 * @returns {Object} Sample table data
 */
function parseSampleTableFromTrak(buffer, trak) {
  // Navigate: trak -> mdia -> minf -> stbl
  const trakChildren = parseAtoms(buffer, trak.dataOffset, trak.size - 8);
  const mdia = findAtom(trakChildren, 'mdia');
  if (!mdia) throw new Error('No mdia atom found in trak');

  const mdiaChildren = parseAtoms(buffer, mdia.dataOffset, mdia.size - 8);
  const minf = findAtom(mdiaChildren, 'minf');
  const mdhd = findAtom(mdiaChildren, 'mdhd');
  if (!minf) throw new Error('No minf atom found in mdia');
  if (!mdhd) throw new Error('No mdhd atom found in mdia');

  const minfChildren = parseAtoms(buffer, minf.dataOffset, minf.size - 8);
  const stbl = findAtom(minfChildren, 'stbl');
  if (!stbl) throw new Error('No stbl atom found in minf');

  const stblChildren = parseAtoms(buffer, stbl.dataOffset, stbl.size - 8);

  // Parse required atoms
  const stcoAtom = findAtom(stblChildren, 'stco');
  const co64Atom = findAtom(stblChildren, 'co64');
  const stszAtom = findAtom(stblChildren, 'stsz');
  const stscAtom = findAtom(stblChildren, 'stsc');
  const stsdAtom = findAtom(stblChildren, 'stsd');
  const sttsAtom = findAtom(stblChildren, 'stts');

  if (!stszAtom) throw new Error('No stsz atom found');
  if (!stscAtom) throw new Error('No stsc atom found');
  if (!stsdAtom) throw new Error('No stsd atom found');
  if (!(stcoAtom || co64Atom)) throw new Error('No stco or co64 atom found');

  const chunkOffsets = stcoAtom
    ? parseStco(buffer, stcoAtom)
    : parseCo64(buffer, co64Atom);

  return {
    chunkOffsets,
    sampleSizes: parseStsz(buffer, stszAtom),
    stscEntries: parseStsc(buffer, stscAtom),
    stsd: parseStsd(buffer, stsdAtom),
    sttsEntries: sttsAtom ? parseStts(buffer, sttsAtom) : [{ sampleCount: 1, sampleDelta: 1 }],
    mdhd: parseMdhd(buffer, mdhd),
  };
}

/**
 * Extract a single track from an M4A file as a playable M4A buffer
 * @param {string} filePath - Path to M4A file
 * @param {number} trackIndex - Track index (0-based)
 * @returns {Promise<Buffer>} Playable M4A file buffer
 */
export async function extractTrack(filePath, trackIndex) {
  const fileBuffer = await fs.readFile(filePath);

  const trak = findTrack(fileBuffer, trackIndex);
  if (!trak) {
    throw new Error(`Track ${trackIndex} not found in file`);
  }

  const sampleTable = parseSampleTableFromTrak(fileBuffer, trak);
  const audioData = extractAudioData(fileBuffer, sampleTable);

  return buildM4aFile({
    audioData,
    stsd: sampleTable.stsd,
    sampleSizes: sampleTable.sampleSizes,
    sttsEntries: sampleTable.sttsEntries,
    mdhd: sampleTable.mdhd,
  });
}

/**
 * Extract all audio tracks from an M4A file
 * @param {string} filePath - Path to M4A file
 * @returns {Promise<Array<Buffer>>} Array of playable M4A file buffers
 */
export async function extractAllTracks(filePath) {
  const fileBuffer = await fs.readFile(filePath);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  const tracks = [];
  for (let i = 0; i < traks.length; i++) {
    try {
      const sampleTable = parseSampleTableFromTrak(fileBuffer, traks[i]);

      // Skip non-audio tracks (check for 'soun' handler type would be more robust)
      // For now, skip tracks with very few samples (likely metadata tracks)
      if (sampleTable.sampleSizes.sampleCount < 100) {
        continue;
      }

      const audioData = extractAudioData(fileBuffer, sampleTable);
      const trackBuffer = buildM4aFile({
        audioData,
        stsd: sampleTable.stsd,
        sampleSizes: sampleTable.sampleSizes,
        sttsEntries: sampleTable.sttsEntries,
        mdhd: sampleTable.mdhd,
      });
      tracks.push(trackBuffer);
    } catch (err) {
      console.warn(`Skipping track ${i}: ${err.message}`);
    }
  }

  return tracks;
}

/**
 * Get track count from an M4A file
 * @param {string} filePath - Path to M4A file
 * @returns {Promise<number>} Number of tracks
 */
export async function getTrackCount(filePath) {
  const fileBuffer = await fs.readFile(filePath);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  return traks.length;
}

/**
 * Get information about all tracks in an M4A file
 * @param {string} filePath - Path to M4A file
 * @returns {Promise<Array>} Array of track info objects
 */
export async function getTrackInfo(filePath) {
  const fileBuffer = await fs.readFile(filePath);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  const trackInfo = [];
  for (let i = 0; i < traks.length; i++) {
    try {
      const sampleTable = parseSampleTableFromTrak(fileBuffer, traks[i]);
      trackInfo.push({
        index: i,
        sampleCount: sampleTable.sampleSizes.sampleCount,
        duration: sampleTable.mdhd.duration / sampleTable.mdhd.timescale,
        timescale: sampleTable.mdhd.timescale,
      });
    } catch (err) {
      trackInfo.push({
        index: i,
        error: err.message,
      });
    }
  }

  return trackInfo;
}

export default {
  extractTrack,
  extractAllTracks,
  getTrackCount,
  getTrackInfo,
};
