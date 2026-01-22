/**
 * M4A Track Extractor
 *
 * Extract individual audio tracks from multi-track M4A/MP4 files
 * without requiring FFmpeg.
 *
 * Works with Uint8Array or ArrayBuffer input.
 * Consumer is responsible for I/O (file reading, fetching, etc).
 */

/**
 * Helper: Read big-endian uint32 from Uint8Array
 */
function readUInt32BE(data, offset) {
  return (
    ((data[offset] << 24) >>> 0) +
    (data[offset + 1] << 16) +
    (data[offset + 2] << 8) +
    data[offset + 3]
  );
}

/**
 * Helper: Read big-endian uint64 from Uint8Array (as Number)
 */
function readBigUInt64BE(data, offset) {
  const high = readUInt32BE(data, offset);
  const low = readUInt32BE(data, offset + 4);
  return high * 0x100000000 + low;
}

/**
 * Helper: Read uint8 from Uint8Array
 */
function readUInt8(data, offset) {
  return data[offset];
}

/**
 * Helper: Read latin1 string from Uint8Array
 */
function readString(data, offset, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(data[offset + i]);
  }
  return str;
}

/**
 * Helper: Write big-endian uint32 to Uint8Array
 */
function writeUInt32BE(data, value, offset) {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

/**
 * Helper: Write big-endian uint16 to Uint8Array
 */
function writeUInt16BE(data, value, offset) {
  data[offset] = (value >>> 8) & 0xff;
  data[offset + 1] = value & 0xff;
}

/**
 * Helper: Write latin1 string to Uint8Array
 */
function writeString(data, str, offset) {
  for (let i = 0; i < str.length; i++) {
    data[offset + i] = str.charCodeAt(i);
  }
}

/**
 * Helper: Concatenate multiple Uint8Arrays
 */
function concatArrays(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Helper: Create a slice of Uint8Array
 */
function sliceArray(data, start, end) {
  return data.slice(start, end);
}

/**
 * Normalize input to Uint8Array
 * Accepts:
 * - Uint8Array (works everywhere)
 * - ArrayBuffer (works everywhere, e.g., from fetch)
 * - Node.js Buffer (Node.js only)
 * @param {Uint8Array|ArrayBuffer|Buffer} data
 * @returns {Uint8Array}
 */
function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  // Node.js Buffer (has .buffer property pointing to underlying ArrayBuffer)
  if (data && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error('Expected Uint8Array, ArrayBuffer, or Node.js Buffer');
}

/**
 * Parse MP4 atoms from buffer
 */
function parseAtoms(buffer, offset = 0, maxLength = null) {
  const atoms = [];
  const endOffset = maxLength ? offset + maxLength : buffer.length;
  let pos = offset;

  while (pos < endOffset - 8) {
    const size = readUInt32BE(buffer, pos);
    const type = readString(buffer, pos + 4, 4);

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
 */
function findAtom(atoms, type) {
  return atoms.find((a) => a.type === type) || null;
}

/**
 * Parse stco (32-bit chunk offset) atom
 */
function parseStco(buffer, atom) {
  const offsets = [];
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);

  for (let i = 0; i < entryCount; i++) {
    const offset = readUInt32BE(buffer, atom.dataOffset + 8 + i * 4);
    offsets.push(offset);
  }

  return offsets;
}

/**
 * Parse co64 (64-bit chunk offset) atom
 */
function parseCo64(buffer, atom) {
  const offsets = [];
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);

  for (let i = 0; i < entryCount; i++) {
    const offset = readBigUInt64BE(buffer, atom.dataOffset + 8 + i * 8);
    offsets.push(offset);
  }

  return offsets;
}

/**
 * Parse stsz (sample sizes) atom
 */
function parseStsz(buffer, atom) {
  const defaultSize = readUInt32BE(buffer, atom.dataOffset + 4);
  const sampleCount = readUInt32BE(buffer, atom.dataOffset + 8);

  if (defaultSize > 0) {
    return { defaultSize, sampleCount, sizes: null };
  }

  const sizes = [];
  for (let i = 0; i < sampleCount; i++) {
    const size = readUInt32BE(buffer, atom.dataOffset + 12 + i * 4);
    sizes.push(size);
  }

  return { defaultSize: 0, sampleCount, sizes };
}

/**
 * Parse stsc (sample-to-chunk) atom
 */
function parseStsc(buffer, atom) {
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = atom.dataOffset + 8 + i * 12;
    entries.push({
      firstChunk: readUInt32BE(buffer, entryOffset),
      samplesPerChunk: readUInt32BE(buffer, entryOffset + 4),
      sampleDescriptionIndex: readUInt32BE(buffer, entryOffset + 8),
    });
  }

  return entries;
}

/**
 * Parse stsd (sample description) atom - returns raw bytes
 */
function parseStsd(buffer, atom) {
  return sliceArray(buffer, atom.offset, atom.offset + atom.size);
}

/**
 * Parse stts (time-to-sample) atom
 */
function parseStts(buffer, atom) {
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = atom.dataOffset + 8 + i * 8;
    entries.push({
      sampleCount: readUInt32BE(buffer, entryOffset),
      sampleDelta: readUInt32BE(buffer, entryOffset + 4),
    });
  }

  return entries;
}

/**
 * Parse mdhd (media header) atom
 */
function parseMdhd(buffer, atom) {
  const version = readUInt8(buffer, atom.dataOffset);

  if (version === 0) {
    return {
      timescale: readUInt32BE(buffer, atom.dataOffset + 12),
      duration: readUInt32BE(buffer, atom.dataOffset + 16),
    };
  } else {
    return {
      timescale: readUInt32BE(buffer, atom.dataOffset + 20),
      duration: readBigUInt64BE(buffer, atom.dataOffset + 24),
    };
  }
}

/**
 * Build sample map from stsc entries
 */
function buildChunkSampleMap(stscEntries, totalChunks) {
  const chunkMap = [];
  let currentSampleIndex = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
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
 */
function extractAudioData(fileBuffer, sampleTable) {
  const { chunkOffsets, sampleSizes, stscEntries } = sampleTable;
  const chunkMap = buildChunkSampleMap(stscEntries, chunkOffsets.length);

  let totalSize = 0;
  if (sampleSizes.sizes) {
    totalSize = sampleSizes.sizes.reduce((sum, size) => sum + size, 0);
  } else {
    totalSize = sampleSizes.sampleCount * sampleSizes.defaultSize;
  }

  const audioData = new Uint8Array(totalSize);
  let writeOffset = 0;

  for (const chunk of chunkMap) {
    let readOffset = chunkOffsets[chunk.chunkIndex];

    for (let i = 0; i < chunk.sampleCount; i++) {
      const sampleIndex = chunk.sampleStart + i;
      const sampleSize = sampleSizes.sizes
        ? sampleSizes.sizes[sampleIndex]
        : sampleSizes.defaultSize;

      audioData.set(
        fileBuffer.subarray(readOffset, readOffset + sampleSize),
        writeOffset
      );
      writeOffset += sampleSize;
      readOffset += sampleSize;
    }
  }

  return audioData;
}

/**
 * Create a minimal MP4 atom
 */
function createAtom(type, data) {
  const size = 8 + data.length;
  const header = new Uint8Array(8);
  writeUInt32BE(header, size, 0);
  writeString(header, type, 4);
  return concatArrays(header, data);
}

/**
 * Build a minimal playable M4A file from extracted track data
 */
function buildM4aFile(trackInfo) {
  const { audioData, stsd, sampleSizes, sttsEntries, mdhd } = trackInfo;

  // Build ftyp
  const ftypData = new Uint8Array([
    0x4d, 0x34, 0x41, 0x20,
    0x00, 0x00, 0x00, 0x00,
    0x4d, 0x34, 0x41, 0x20,
    0x6d, 0x70, 0x34, 0x32,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  const ftyp = createAtom('ftyp', ftypData);

  // Build stts
  const sttsData = new Uint8Array(8 + sttsEntries.length * 8);
  writeUInt32BE(sttsData, 0, 0);
  writeUInt32BE(sttsData, sttsEntries.length, 4);
  for (let i = 0; i < sttsEntries.length; i++) {
    writeUInt32BE(sttsData, sttsEntries[i].sampleCount, 8 + i * 8);
    writeUInt32BE(sttsData, sttsEntries[i].sampleDelta, 8 + i * 8 + 4);
  }
  const stts = createAtom('stts', sttsData);

  // Build stsc
  const stscData = new Uint8Array(8 + 12);
  writeUInt32BE(stscData, 0, 0);
  writeUInt32BE(stscData, 1, 4);
  writeUInt32BE(stscData, 1, 8);
  writeUInt32BE(stscData, sampleSizes.sampleCount, 12);
  writeUInt32BE(stscData, 1, 16);
  const stsc = createAtom('stsc', stscData);

  // Build stsz
  let stsz;
  if (sampleSizes.defaultSize > 0) {
    const stszData = new Uint8Array(12);
    writeUInt32BE(stszData, 0, 0);
    writeUInt32BE(stszData, sampleSizes.defaultSize, 4);
    writeUInt32BE(stszData, sampleSizes.sampleCount, 8);
    stsz = createAtom('stsz', stszData);
  } else {
    const stszData = new Uint8Array(12 + sampleSizes.sizes.length * 4);
    writeUInt32BE(stszData, 0, 0);
    writeUInt32BE(stszData, 0, 4);
    writeUInt32BE(stszData, sampleSizes.sizes.length, 8);
    for (let i = 0; i < sampleSizes.sizes.length; i++) {
      writeUInt32BE(stszData, sampleSizes.sizes[i], 12 + i * 4);
    }
    stsz = createAtom('stsz', stszData);
  }

  // Build stco placeholder
  const stcoData = new Uint8Array(12);
  writeUInt32BE(stcoData, 0, 0);
  writeUInt32BE(stcoData, 1, 4);
  const stco = createAtom('stco', stcoData);

  // Build stbl
  const stbl = createAtom('stbl', concatArrays(stsd, stts, stsc, stsz, stco));

  // Build dinf with dref
  const drefData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x0c,
    0x75, 0x72, 0x6c, 0x20,
    0x00, 0x00, 0x00, 0x01,
  ]);
  const dref = createAtom('dref', drefData);
  const dinf = createAtom('dinf', dref);

  // Build smhd
  const smhdData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
    0x00, 0x00,
  ]);
  const smhd = createAtom('smhd', smhdData);

  // Build minf
  const minf = createAtom('minf', concatArrays(smhd, dinf, stbl));

  // Build hdlr
  const hdlrData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x73, 0x6f, 0x75, 0x6e,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00,
  ]);
  const hdlr = createAtom('hdlr', hdlrData);

  // Build mdhd
  const mdhdData = new Uint8Array(24);
  writeUInt32BE(mdhdData, 0, 0);
  writeUInt32BE(mdhdData, 0, 4);
  writeUInt32BE(mdhdData, 0, 8);
  writeUInt32BE(mdhdData, mdhd.timescale, 12);
  writeUInt32BE(mdhdData, mdhd.duration, 16);
  writeUInt16BE(mdhdData, 0x55c4, 20);
  writeUInt16BE(mdhdData, 0, 22);
  const mdhdAtom = createAtom('mdhd', mdhdData);

  // Build mdia
  const mdia = createAtom('mdia', concatArrays(mdhdAtom, hdlr, minf));

  // Build tkhd
  const tkhdData = new Uint8Array(84);
  tkhdData[0] = 0;
  tkhdData[1] = 0;
  tkhdData[2] = 0;
  tkhdData[3] = 0x07;
  writeUInt32BE(tkhdData, 1, 12);
  writeUInt32BE(tkhdData, mdhd.duration, 20);
  writeUInt32BE(tkhdData, 0x00010000, 76);
  const tkhd = createAtom('tkhd', tkhdData);

  // Build trak
  const trak = createAtom('trak', concatArrays(tkhd, mdia));

  // Build mvhd
  const mvhdData = new Uint8Array(100);
  writeUInt32BE(mvhdData, 0, 0);
  writeUInt32BE(mvhdData, mdhd.timescale, 12);
  writeUInt32BE(mvhdData, mdhd.duration, 16);
  writeUInt32BE(mvhdData, 0x00010000, 20);
  writeUInt16BE(mvhdData, 0x0100, 24);
  writeUInt32BE(mvhdData, 0x00010000, 36);
  writeUInt32BE(mvhdData, 0x00010000, 52);
  writeUInt32BE(mvhdData, 0x40000000, 68);
  writeUInt32BE(mvhdData, 2, 96);
  const mvhd = createAtom('mvhd', mvhdData);

  // Build moov
  const moov = createAtom('moov', concatArrays(mvhd, trak));

  // Build mdat
  const mdat = createAtom('mdat', audioData);

  // Update chunk offset
  const chunkOffset = ftyp.length + moov.length + 8;
  writeUInt32BE(moov, chunkOffset, moov.length - stco.length + 8 + 8);

  return concatArrays(ftyp, moov, mdat);
}

/**
 * Find a trak atom by index
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
 */
function parseSampleTableFromTrak(buffer, trak) {
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
 * Extract a single track as a playable M4A
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @param {number} trackIndex - Track index (0-based)
 * @returns {Uint8Array} Playable M4A file
 */
export function extractTrack(data, trackIndex) {
  const fileBuffer = toUint8Array(data);

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
 * Extract all audio tracks as playable M4A files
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @returns {Array<Uint8Array>} Array of playable M4A files
 */
export function extractAllTracks(data) {
  const fileBuffer = toUint8Array(data);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  const tracks = [];
  for (let i = 0; i < traks.length; i++) {
    try {
      const sampleTable = parseSampleTableFromTrak(fileBuffer, traks[i]);

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
 * Get track count
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @returns {number} Number of tracks
 */
export function getTrackCount(data) {
  const fileBuffer = toUint8Array(data);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  return traks.length;
}

/**
 * Get information about all tracks
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @returns {Array} Array of track info objects
 */
export function getTrackInfo(data) {
  const fileBuffer = toUint8Array(data);

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
