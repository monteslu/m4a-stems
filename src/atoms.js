/**
 * Custom MP4 Atom Handling
 * Write and read custom atoms for karaoke extensions
 */

import fs from 'fs/promises';

// Custom atom names
export const ATOM_NAMES = {
  KARA: '----:com.stems:kara',  // Karaoke Data (JSON)
  VPCH: '----:com.stems:vpch',  // Vocal Pitch (binary)
  KONS: '----:com.stems:kons',  // Karaoke Onsets (binary)
  NI_STEMS: '----:com.native-instruments:stems',  // NI Stems metadata
};

/**
 * Write kara (Karaoke Data) atom to MP4 file
 * @param {string} filePath - Path to MP4 file
 * @param {Object} karaData - Karaoke data to write (will be JSON-encoded)
 */
export async function writeKaraAtom(filePath, karaData) {
  const karaJson = JSON.stringify(karaData);
  await injectKaraAtom(filePath, filePath, karaJson);
}

/**
 * Write vpch (Vocal Pitch) atom to MP4 file
 * @param {string} filePath - Path to MP4 file
 * @param {Object} pitchData - Pitch data object with sampleRate and data array
 * Example: { sampleRate: 25, data: [{ midi: 60, cents: 15 }, ...] }
 */
export async function writeVpchAtom(filePath, pitchData) {
  if (!pitchData || !pitchData.data || !Array.isArray(pitchData.data)) {
    throw new Error('Invalid pitch data: must have sampleRate and data array');
  }

  console.log(`🎵 Writing vocal pitch atom (${pitchData.data.length} samples at ${pitchData.sampleRate}Hz)`);

  // Create binary buffer
  const dataLength = pitchData.data.length;
  const binaryData = Buffer.alloc(9 + dataLength * 2);

  // Version (1 byte)
  binaryData.writeUInt8(1, 0);

  // Sample rate (4 bytes, big-endian)
  binaryData.writeUInt32BE(pitchData.sampleRate || 25, 1);

  // Data length (4 bytes, big-endian)
  binaryData.writeUInt32BE(dataLength, 5);

  // Pitch data (2 bytes per sample)
  let offset = 9;
  for (const sample of pitchData.data) {
    const midi = Math.max(0, Math.min(127, sample.midi || 0));
    const cents = Math.max(-50, Math.min(50, sample.cents || 0));

    binaryData.writeUInt8(midi, offset);
    binaryData.writeInt8(cents, offset + 1);
    offset += 2;
  }

  // Create freeform atom and inject
  const vpchAtomData = createBinaryFreeformAtom('com.stems', 'vpch', binaryData);
  await injectFreeformAtomToIlst(filePath, vpchAtomData);

  console.log(`✅ Vocal pitch atom written (${binaryData.length} bytes)`);
}

/**
 * Write kons (Karaoke Onsets) atom to MP4 file
 * @param {string} filePath - Path to MP4 file
 * @param {Array<number>} onsetsData - Array of onset times in seconds
 */
export async function writeKonsAtom(filePath, onsetsData) {
  if (!onsetsData || !Array.isArray(onsetsData)) {
    throw new Error('Invalid onsets data: must be array of times in seconds');
  }

  console.log(`🎯 Writing onsets atom (${onsetsData.length} onsets)`);

  // Create binary buffer
  const dataLength = onsetsData.length;
  const binaryData = Buffer.alloc(5 + dataLength * 4);

  // Version (1 byte)
  binaryData.writeUInt8(1, 0);

  // Data length (4 bytes, big-endian)
  binaryData.writeUInt32BE(dataLength, 1);

  // Onset times (4 bytes per onset, in milliseconds)
  let offset = 5;
  for (const timeSec of onsetsData) {
    const timeMs = Math.round(timeSec * 1000);
    binaryData.writeUInt32BE(timeMs, offset);
    offset += 4;
  }

  // Create freeform atom and inject
  const konsAtomData = createBinaryFreeformAtom('com.stems', 'kons', binaryData);
  await injectFreeformAtomToIlst(filePath, konsAtomData);

  console.log(`✅ Onsets atom written (${binaryData.length} bytes)`);
}

/**
 * Add NI Stems metadata to MP4 file
 * @param {string} filePath - Path to MP4 file
 * @param {Array<string>} stemNames - Array of stem names (default: Drums, Bass, Other, Vocals)
 */
export async function addNiStemsMetadata(filePath, stemNames = null) {
  if (!stemNames) {
    stemNames = ['Drums', 'Bass', 'Other', 'Vocals'];
  }

  // Default colors for each stem
  const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];

  console.log(`🎛️  Adding NI Stems metadata to ${filePath}`);

  // Build stems metadata following NI STEMS specification
  const stemsMetadata = {
    version: 1,
    mastering_dsp: {
      compressor: {
        enabled: true,
        input_gain: 0.0,
        output_gain: 0.0,
        threshold: -6.0,
        dry_wet: 100,
        attack: 0.003,
        release: 0.3,
        ratio: 2.0,
        hp_cutoff: 20,
      },
      limiter: {
        enabled: true,
        threshold: -0.3,
        ceiling: -0.3,
        release: 0.05,
      },
    },
    stems: stemNames.map((name, i) => ({
      name,
      color: colors[i] || '#FFFFFF',
    })),
  };

  // Encode metadata as JSON
  const metadataJson = JSON.stringify(stemsMetadata, null, 2);
  const metadataBytes = Buffer.from(metadataJson, 'utf-8');

  // Inject stem atom into moov/udta/stem
  await injectStemAtom(filePath, metadataBytes);

  console.log(`✅ NI Stems metadata added (${stemNames.length} stems)`);
}

/**
 * Disable specific audio tracks in MP4 file
 * @param {string} filePath - Path to MP4 file
 * @param {Array<number>} trackIndices - Indices of tracks to disable (0-based)
 */
export async function disableTracks(filePath, trackIndices) {
  console.log(`Track disabling not yet implemented - skipping tracks ${trackIndices.join(', ')}`);
  // TODO: Implement track disabling
}

/**
 * Add musical key metadata for DJ software (harmonic mixing)
 * @param {string} filePath - Path to MP4 file
 * @param {string} musicalKey - Musical key (e.g., "Am", "C#m", "5A")
 */
export async function addMusicalKey(filePath, musicalKey) {
  console.log(`🎵 Adding musical key: ${musicalKey}`);

  // Create freeform atom data for ----:com.apple.iTunes:initialkey
  const namespace = 'com.apple.iTunes';
  const name = 'initialkey';
  const keyData = Buffer.from(musicalKey, 'utf8');

  // Create 'mean' atom (namespace)
  const meanData = Buffer.alloc(4 + namespace.length);
  meanData.writeUInt32BE(0, 0); // Version/flags
  meanData.write(namespace, 4, namespace.length, 'utf8');
  const meanAtom = createAtom('mean', meanData);

  // Create 'name' atom
  const nameData = Buffer.alloc(4 + name.length);
  nameData.writeUInt32BE(0, 0); // Version/flags
  nameData.write(name, 4, name.length, 'utf8');
  const nameAtom = createAtom('name', nameData);

  // Create 'data' atom (type 1 = UTF-8 text)
  const dataHeader = Buffer.alloc(8);
  dataHeader.writeUInt32BE(1, 0); // Type: UTF-8 text
  dataHeader.writeUInt32BE(0, 4); // Locale
  const dataAtom = createAtom('data', Buffer.concat([dataHeader, keyData]));

  // Create ---- atom (freeform)
  const freeformData = Buffer.concat([meanAtom, nameAtom, dataAtom]);
  const freeformAtom = createAtom('----', freeformData);

  // Inject into ilst
  await injectAtomToIlst(filePath, freeformAtom);

  console.log(`✅ Musical key added: ${musicalKey}`);
}

/**
 * Add standard MP4 metadata atoms (title, artist, album, year, genre, BPM)
 * @param {string} filePath - Path to MP4 file
 * @param {Object} metadata - Metadata object
 * @param {string} metadata.title - Song title
 * @param {string} metadata.artist - Artist name
 * @param {string} metadata.album - Album name
 * @param {string|number} metadata.year - Release year
 * @param {string} metadata.genre - Genre
 * @param {number} metadata.tempo - BPM (beats per minute)
 */
export async function addStandardMetadata(filePath, metadata) {
  const atomsToWrite = [];

  // Helper to create text metadata atom
  const createTextAtom = (atomType, text) => {
    if (!text) return null;

    const textData = Buffer.from(String(text), 'utf8');

    // Create 'data' atom (type 1 = UTF-8 text)
    const dataHeader = Buffer.alloc(8);
    dataHeader.writeUInt32BE(1, 0); // Type: UTF-8 text
    dataHeader.writeUInt32BE(0, 4); // Locale
    const dataAtom = createAtom('data', Buffer.concat([dataHeader, textData]));

    return createAtom(atomType, dataAtom);
  };

  // Helper to create BPM atom
  const createBpmAtom = (bpm) => {
    if (!bpm || isNaN(bpm)) return null;

    const bpmValue = parseInt(bpm, 10);
    const dataPayload = Buffer.alloc(2);
    dataPayload.writeUInt16BE(bpmValue, 0);

    // Create 'data' atom (type 21 = big-endian integer)
    const dataHeader = Buffer.alloc(8);
    dataHeader.writeUInt32BE(21, 0); // Type: 21 = big-endian integer
    dataHeader.writeUInt32BE(0, 4); // Locale
    const dataAtom = createAtom('data', Buffer.concat([dataHeader, dataPayload]));

    return createAtom('tmpo', dataAtom);
  };

  // Build atoms for provided metadata
  if (metadata.title) {
    const atom = createTextAtom('©nam', metadata.title);
    if (atom) atomsToWrite.push({ name: 'title', atom });
  }

  if (metadata.artist) {
    const atom = createTextAtom('©ART', metadata.artist);
    if (atom) atomsToWrite.push({ name: 'artist', atom });
  }

  if (metadata.album) {
    const atom = createTextAtom('©alb', metadata.album);
    if (atom) atomsToWrite.push({ name: 'album', atom });
  }

  if (metadata.year) {
    const atom = createTextAtom('©day', String(metadata.year));
    if (atom) atomsToWrite.push({ name: 'year', atom });
  }

  if (metadata.genre) {
    const atom = createTextAtom('©gen', metadata.genre);
    if (atom) atomsToWrite.push({ name: 'genre', atom });
  }

  if (metadata.tempo) {
    const atom = createBpmAtom(metadata.tempo);
    if (atom) atomsToWrite.push({ name: 'BPM', atom });
  }

  // Write all atoms
  if (atomsToWrite.length === 0) {
    console.log('ℹ️  No standard metadata to write');
    return;
  }

  console.log(`📝 Writing ${atomsToWrite.length} standard metadata atoms: ${atomsToWrite.map(a => a.name).join(', ')}`);

  for (const { atom } of atomsToWrite) {
    await injectAtomToIlst(filePath, atom);
  }

  console.log(`✅ Standard metadata written successfully`);
}

/**
 * Add track number metadata
 * @param {string} filePath - Path to MP4 file
 * @param {number|string|Object} trackInfo - Track number (int, string, or {no: X, of: Y})
 */
export async function addTrackNumber(filePath, trackInfo) {
  let trackNo = 0;
  let trackOf = 0;

  if (typeof trackInfo === 'number') {
    trackNo = trackInfo;
  } else if (typeof trackInfo === 'string' && !isNaN(trackInfo)) {
    trackNo = parseInt(trackInfo, 10);
  } else if (typeof trackInfo === 'object' && trackInfo.no !== undefined) {
    trackNo = trackInfo.no;
    trackOf = trackInfo.of || 0;
  } else {
    console.warn(`Invalid track number format: ${JSON.stringify(trackInfo)}`);
    return;
  }

  console.log(`🔢 Adding track number: ${trackNo}${trackOf ? `/${trackOf}` : ''}`);

  // Create trkn atom data (8 bytes: reserved + track_no + track_of + reserved)
  const dataPayload = Buffer.alloc(8);
  dataPayload.writeUInt16BE(0, 0); // Reserved
  dataPayload.writeUInt16BE(trackNo, 2); // Track number
  dataPayload.writeUInt16BE(trackOf, 4); // Total tracks
  dataPayload.writeUInt16BE(0, 6); // Reserved

  // Create 'data' atom (type 0 = implicit/binary)
  const dataHeader = Buffer.alloc(8);
  dataHeader.writeUInt32BE(0, 0); // Type: binary/implicit
  dataHeader.writeUInt32BE(0, 4); // Locale
  const dataAtom = createAtom('data', Buffer.concat([dataHeader, dataPayload]));

  // Create trkn atom
  const trknAtom = createAtom('trkn', dataAtom);

  // Inject into ilst
  await injectAtomToIlst(filePath, trknAtom);

  console.log(`✅ Track number added: ${trackNo}${trackOf ? `/${trackOf}` : ''}`);
}

/**
 * Read kara (Karaoke Data) atom from MP4 file
 * @param {string} filePath - Path to MP4 file
 * @returns {Promise<Object|null>} Parsed kara data or null if not found
 */
export async function readKaraAtom(filePath) {
  try {
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(filePath);

    // Check for kara atom
    if (metadata.native?.iTunes) {
      const karaAtom = metadata.native.iTunes.find((tag) => tag.id === ATOM_NAMES.KARA);

      if (karaAtom && karaAtom.value) {
        try {
          return JSON.parse(karaAtom.value);
        } catch (parseErr) {
          throw new Error(`Failed to parse kara atom: ${parseErr.message}`);
        }
      }
    }

    return null;
  } catch (error) {
    throw new Error(`Failed to read kara atom: ${error.message}`);
  }
}

/**
 * Get karaoke features from an M4A file
 * @param {string} filePath - Path to MP4 file
 * @returns {Promise<Object>} Karaoke features flags
 */
export async function getKaraokeFeatures(filePath) {
  try {
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(filePath);

    const features = {
      has_lyrics: false,
      has_word_timing: false,
      has_advanced: false,
    };

    // Check for kara atom
    if (metadata.native?.iTunes) {
      const karaAtom = metadata.native.iTunes.find((tag) => tag.id === ATOM_NAMES.KARA);

      if (karaAtom) {
        features.has_lyrics = true;

        // Parse to check for word timing
        try {
          const karaData = JSON.parse(karaAtom.value);
          const lines = karaData.lines || [];
          features.has_word_timing = lines.some((line) => 'word_timing' in line);

          // Check for multiple singers
          const singers = karaData.singers || [];
          if (singers.length > 1) {
            features.has_advanced = true;
          }
        } catch (err) {
          console.warn('Could not parse kara data:', err.message);
        }
      }

      // Check for advanced features (pitch, onsets)
      const vpchAtom = metadata.native.iTunes.find((tag) => tag.id === ATOM_NAMES.VPCH);
      const konsAtom = metadata.native.iTunes.find((tag) => tag.id === ATOM_NAMES.KONS);

      if (vpchAtom || konsAtom) {
        features.has_advanced = true;
      }
    }

    return features;
  } catch (error) {
    throw new Error(`Failed to get karaoke features: ${error.message}`);
  }
}

// ============================================================================
// Internal MP4 atom injection utilities (ported from kai-player)
// ============================================================================

/**
 * Inject kara atom into M4A file
 * Parses MP4 structure and injects custom ----:com.stems:kara atom
 */
async function injectKaraAtom(inputPath, outputPath, karaJson) {
  try {
    // Read the entire file
    const fileBuffer = await fs.readFile(inputPath);

    console.log('🔍 Parsing MP4 structure...');

    // Parse MP4 atoms
    const atoms = parseMP4Atoms(fileBuffer);

    // Find moov atom
    const moovAtom = atoms.find((a) => a.type === 'moov');
    if (!moovAtom) {
      throw new Error('No moov atom found in M4A file');
    }

    console.log('📦 Found moov atom at offset', moovAtom.offset);

    // Create the kara atom data
    const karaAtomData = createKaraAtom(karaJson);

    console.log(`📝 Created kara atom (${karaAtomData.length} bytes)`);

    // Find or create udta atom inside moov
    const moovChildren = parseMP4Atoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
    const udtaAtom = moovChildren.find((a) => a.type === 'udta');

    let newMoovData;

    if (!udtaAtom) {
      console.log('📦 Creating new udta atom...');
      // Create new udta atom with meta > ilst > kara
      const metaIlstKara = createMetaIlstKaraStructure(karaAtomData);
      const udtaData = createAtom('udta', metaIlstKara);

      // Insert udta at end of moov children
      const moovDataEnd = moovAtom.dataOffset + moovAtom.size - 8;
      const beforeUdta = fileBuffer.slice(moovAtom.dataOffset, moovDataEnd);

      newMoovData = Buffer.concat([beforeUdta, udtaData]);
    } else {
      console.log('📦 Found existing udta atom, updating...');
      // Parse udta children
      const udtaChildren = parseMP4Atoms(fileBuffer, udtaAtom.dataOffset, udtaAtom.size - 8);
      const metaAtom = udtaChildren.find((a) => a.type === 'meta');

      if (!metaAtom) {
        console.log('📦 Creating new meta atom in udta...');
        // Create meta > ilst > kara
        const metaIlstKara = createMetaIlstKaraStructure(karaAtomData);

        // Rebuild udta with new meta
        const beforeMeta = fileBuffer.slice(udtaAtom.dataOffset, udtaAtom.offset + udtaAtom.size);
        const newUdtaData = Buffer.concat([beforeMeta, metaIlstKara]);
        const newUdta = createAtom('udta', newUdtaData);

        // Rebuild moov
        const beforeUdta = fileBuffer.slice(moovAtom.dataOffset, udtaAtom.offset);
        const afterUdta = fileBuffer.slice(
          udtaAtom.offset + udtaAtom.size,
          moovAtom.offset + moovAtom.size
        );

        newMoovData = Buffer.concat([beforeUdta, newUdta, afterUdta]);
      } else {
        console.log('📦 Updating existing meta atom...');
        // Update ilst in meta with new kara
        const newMetaData = updateMetaWithKara(fileBuffer, metaAtom, karaAtomData);
        const newMeta = createAtom('meta', newMetaData);

        // Rebuild udta
        const beforeMeta = fileBuffer.slice(udtaAtom.dataOffset, metaAtom.offset);
        const afterMeta = fileBuffer.slice(
          metaAtom.offset + metaAtom.size,
          udtaAtom.offset + udtaAtom.size
        );
        const newUdtaData = Buffer.concat([beforeMeta, newMeta, afterMeta]);
        const newUdta = createAtom('udta', newUdtaData);

        // Rebuild moov
        const beforeUdta = fileBuffer.slice(moovAtom.dataOffset, udtaAtom.offset);
        const afterUdta = fileBuffer.slice(
          udtaAtom.offset + udtaAtom.size,
          moovAtom.offset + moovAtom.size
        );

        newMoovData = Buffer.concat([beforeUdta, newUdta, afterUdta]);
      }
    }

    // Create new moov atom
    const newMoov = createAtom('moov', newMoovData);

    // Calculate size delta (how much moov grew)
    const oldMoovSize = moovAtom.size;
    const newMoovSize = newMoov.length;
    const sizeDelta = newMoovSize - oldMoovSize;

    console.log(
      `📊 Moov size change: ${oldMoovSize} -> ${newMoovSize} (delta: ${sizeDelta} bytes)`
    );

    // CRITICAL: Update chunk offset tables before rebuilding file
    if (sizeDelta !== 0) {
      const originalMoovEnd = moovAtom.offset + oldMoovSize;
      console.log('🔧 Updating chunk offset tables...');
      updateChunkOffsets(newMoov, sizeDelta, originalMoovEnd);
    }

    // Rebuild entire file
    const beforeMoov = fileBuffer.slice(0, moovAtom.offset);
    const afterMoov = fileBuffer.slice(moovAtom.offset + moovAtom.size);

    const newFileBuffer = Buffer.concat([beforeMoov, newMoov, afterMoov]);

    // Write to output
    await fs.writeFile(outputPath, newFileBuffer);

    console.log('✅ Successfully injected kara atom into M4A file');
  } catch (error) {
    throw new Error(`Failed to inject kara atom: ${error.message}`);
  }
}

/**
 * Parse MP4 atoms from buffer
 */
function parseMP4Atoms(buffer, offset = 0, maxLength = null) {
  const atoms = [];
  const endOffset = maxLength ? offset + maxLength : buffer.length;
  let pos = offset;

  while (pos < endOffset - 8) {
    // Read size (4 bytes) and type (4 bytes)
    const size = buffer.readUInt32BE(pos);
    // Use latin1 encoding because MP4 atom types use byte 0xA9 for ©, not UTF-8
    const type = buffer.toString('latin1', pos + 4, pos + 8);

    if (size === 0 || size > buffer.length - pos) {
      break; // Invalid atom
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
 * Dump the complete atom tree structure of an MP4 file
 * @param {string} filePath - Path to MP4 file
 * @param {number} maxDepth - Maximum depth to traverse (default: 10)
 * @returns {Promise<Array>} Array of atom objects with type, size, offset, and children
 */
export async function dumpAtomTree(filePath, maxDepth = 10) {
  const buffer = await fs.readFile(filePath);

  function parseAtomsRecursive(buf, offset, endOffset, depth = 0) {
    const atoms = [];
    let pos = offset;

    while (pos < endOffset - 8) {
      const size = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);

      if (size === 0 || size < 8 || pos + size > buf.length) {
        break;
      }

      const atom = {
        type,
        size,
        offset: pos,
      };

      // Container atoms that have children
      const containerAtoms = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst', 'edts', '----'];

      if (containerAtoms.includes(type) && depth < maxDepth) {
        // meta atom has 4 bytes of version/flags before children
        const childOffset = type === 'meta' ? pos + 12 : pos + 8;
        const childEndOffset = pos + size;

        if (childOffset < childEndOffset) {
          atom.children = parseAtomsRecursive(buf, childOffset, childEndOffset, depth + 1);
        }
      }

      atoms.push(atom);
      pos += size;
    }

    return atoms;
  }

  return parseAtomsRecursive(buffer, 0, buffer.length, 0);
}

/**
 * Create an MP4 atom with type and data
 */
function createAtom(type, data) {
  const size = 8 + data.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  // Use latin1 encoding to preserve byte 0xA9 for © character in atom types
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, data]);
}

/**
 * Create kara atom with JSON data
 */
function createKaraAtom(karaJson) {
  // Custom atom format: ----:com.stems:kara
  // Structure: [mean][name][data]

  const namespace = 'com.stems';
  const name = 'kara';
  const jsonData = Buffer.from(karaJson, 'utf8');

  // Create 'mean' atom (namespace)
  const meanData = Buffer.alloc(4 + namespace.length);
  meanData.writeUInt32BE(0, 0); // Version/flags
  meanData.write(namespace, 4, namespace.length, 'utf8');
  const meanAtom = createAtom('mean', meanData);

  // Create 'name' atom
  const nameData = Buffer.alloc(4 + name.length);
  nameData.writeUInt32BE(0, 0); // Version/flags
  nameData.write(name, 4, name.length, 'utf8');
  const nameAtom = createAtom('name', nameData);

  // Create 'data' atom
  const dataHeader = Buffer.alloc(8);
  dataHeader.writeUInt32BE(1, 0); // Type: UTF-8 text
  dataHeader.writeUInt32BE(0, 4); // Locale
  const dataAtom = createAtom('data', Buffer.concat([dataHeader, jsonData]));

  // Create ---- atom (freeform)
  const freeformData = Buffer.concat([meanAtom, nameAtom, dataAtom]);
  return createAtom('----', freeformData);
}

/**
 * Create binary freeform atom (for vpch, kons, etc.)
 * @param {string} namespace - Namespace (e.g., 'com.stems')
 * @param {string} name - Atom name (e.g., 'vpch', 'kons')
 * @param {Buffer} binaryData - Binary data to store
 * @returns {Buffer} Freeform atom buffer
 */
function createBinaryFreeformAtom(namespace, name, binaryData) {
  // Create 'mean' atom (namespace)
  const meanData = Buffer.alloc(4 + namespace.length);
  meanData.writeUInt32BE(0, 0); // Version/flags
  meanData.write(namespace, 4, namespace.length, 'utf8');
  const meanAtom = createAtom('mean', meanData);

  // Create 'name' atom
  const nameData = Buffer.alloc(4 + name.length);
  nameData.writeUInt32BE(0, 0); // Version/flags
  nameData.write(name, 4, name.length, 'utf8');
  const nameAtom = createAtom('name', nameData);

  // Create 'data' atom with binary type (0 = binary/implicit)
  const dataHeader = Buffer.alloc(8);
  dataHeader.writeUInt32BE(0, 0); // Type: binary/implicit
  dataHeader.writeUInt32BE(0, 4); // Locale
  const dataAtom = createAtom('data', Buffer.concat([dataHeader, binaryData]));

  // Create ---- atom (freeform)
  const freeformData = Buffer.concat([meanAtom, nameAtom, dataAtom]);
  return createAtom('----', freeformData);
}

/**
 * Create meta > ilst > kara structure
 */
function createMetaIlstKaraStructure(karaAtomData) {
  // Create ilst with kara
  const ilstData = karaAtomData;
  const ilst = createAtom('ilst', ilstData);

  // Create meta with version/flags (0) + hdlr + ilst
  const metaVersion = Buffer.alloc(4);
  metaVersion.writeUInt32BE(0, 0);

  // Create hdlr atom for meta
  const hdlrData = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // Version/flags
    0x00, 0x00, 0x00, 0x00, // Pre-defined
    0x6d, 0x64, 0x69, 0x72, // Handler type: 'mdir'
    0x61, 0x70, 0x70, 0x6c, // Reserved: 'appl'
    0x00, 0x00, 0x00, 0x00, // Reserved
    0x00, 0x00, 0x00, 0x00, // Reserved
    0x00, // Name (empty)
  ]);
  const hdlr = createAtom('hdlr', hdlrData);

  return Buffer.concat([metaVersion, hdlr, ilst]);
}

/**
 * Update meta atom with new kara data
 */
function updateMetaWithKara(fileBuffer, metaAtom, karaAtomData) {
  // Parse meta children (skip 4-byte version/flags)
  const metaChildren = parseMP4Atoms(
    fileBuffer,
    metaAtom.dataOffset + 4,
    metaAtom.size - 12
  );
  const ilstAtom = metaChildren.find((a) => a.type === 'ilst');

  if (!ilstAtom) {
    console.log('📦 Creating new ilst in meta...');
    // Add ilst to end of meta
    const beforeIlst = fileBuffer.slice(
      metaAtom.dataOffset,
      metaAtom.dataOffset + metaAtom.size - 8
    );
    const ilst = createAtom('ilst', karaAtomData);
    return Buffer.concat([beforeIlst, ilst]);
  }

  // Parse ilst children to find existing kara
  const ilstChildren = parseMP4Atoms(fileBuffer, ilstAtom.dataOffset, ilstAtom.size - 8);
  const existingKara = ilstChildren.find((a) => a.type === '----');

  if (existingKara) {
    console.log('📦 Replacing existing kara atom...');
    // Replace existing kara
    const beforeKara = fileBuffer.slice(ilstAtom.dataOffset, existingKara.offset);
    const afterKara = fileBuffer.slice(
      existingKara.offset + existingKara.size,
      ilstAtom.offset + ilstAtom.size
    );
    const newIlstData = Buffer.concat([beforeKara, karaAtomData, afterKara]);
    const newIlst = createAtom('ilst', newIlstData);

    // Rebuild meta
    const beforeIlst = fileBuffer.slice(metaAtom.dataOffset, ilstAtom.offset);
    const afterIlst = fileBuffer.slice(
      ilstAtom.offset + ilstAtom.size,
      metaAtom.offset + metaAtom.size
    );

    return Buffer.concat([beforeIlst, newIlst, afterIlst]);
  } else {
    console.log('📦 Adding new kara atom to ilst...');
    // Add kara to ilst
    const beforeNewKara = fileBuffer.slice(
      ilstAtom.dataOffset,
      ilstAtom.dataOffset + ilstAtom.size - 8
    );
    const newIlstData = Buffer.concat([beforeNewKara, karaAtomData]);
    const newIlst = createAtom('ilst', newIlstData);

    // Rebuild meta
    const beforeIlst = fileBuffer.slice(metaAtom.dataOffset, ilstAtom.offset);
    const afterIlst = fileBuffer.slice(
      ilstAtom.offset + ilstAtom.size,
      metaAtom.offset + metaAtom.size
    );

    return Buffer.concat([beforeIlst, newIlst, afterIlst]);
  }
}

/**
 * Update chunk offset tables (stco/co64) in moov atom
 * This is CRITICAL when modifying moov size - prevents file corruption
 */
function updateChunkOffsets(moovBuffer, sizeDelta, shiftThreshold) {
  let stcoCount = 0;
  let co64Count = 0;
  let totalUpdated = 0;

  const searchAtoms = (buffer, start, end) => {
    let pos = start;

    while (pos < end - 8 && pos < buffer.length - 8) {
      try {
        const size = buffer.readUInt32BE(pos);
        if (size < 8 || size > end - pos) {
          pos += 8;
          continue;
        }

        const atype = buffer.toString('utf8', pos + 4, pos + 8);

        // Update 32-bit chunk offset table (stco)
        if (atype === 'stco') {
          stcoCount++;
          const entryCount = buffer.readUInt32BE(pos + 12);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 4;
            const chunkOffset = buffer.readUInt32BE(offsetPos);

            // Only update offsets pointing to data after the original moov end
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + sizeDelta;
              buffer.writeUInt32BE(newOffset, offsetPos);
              totalUpdated++;
            }
          }
        }
        // Update 64-bit chunk offset table (co64)
        else if (atype === 'co64') {
          co64Count++;
          const entryCount = buffer.readUInt32BE(pos + 12);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 8;
            const chunkOffset = Number(buffer.readBigUInt64BE(offsetPos));

            // Only update offsets pointing to data after the original moov end
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + sizeDelta;
              buffer.writeBigUInt64BE(BigInt(newOffset), offsetPos);
              totalUpdated++;
            }
          }
        }
        // Recursively search container atoms
        else if (['trak', 'mdia', 'minf', 'stbl', 'moov'].includes(atype)) {
          searchAtoms(buffer, pos + 8, pos + size);
        }

        pos += size;
      } catch (error) {
        console.warn(`  Error parsing atom at ${pos}:`, error.message);
        pos += 8;
      }
    }
  };

  searchAtoms(moovBuffer, 0, moovBuffer.length);
  console.log(
    `✅ Chunk offset update complete: ${stcoCount} stco + ${co64Count} co64 atoms, ${totalUpdated} offsets updated`
  );
}

/**
 * Inject stem atom into moov/udta/stem location and update chunk offset tables
 * @param {string} filePath - Path to MP4 file
 * @param {Buffer} stemData - Stem metadata as bytes
 */
async function injectStemAtom(filePath, stemData) {
  // Read entire file
  const data = await fs.readFile(filePath);
  let fileBuffer = Buffer.from(data);

  // Find moov atom
  const atoms = parseMP4Atoms(fileBuffer, 0);
  const moovAtom = atoms.find((a) => a.type === 'moov');

  if (!moovAtom) {
    throw new Error('No moov atom found');
  }

  // Store original moov end position - this is where mdat starts
  const originalMoovEnd = moovAtom.offset + moovAtom.size;

  // Find or create udta atom within moov
  const moovChildren = parseMP4Atoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
  let udtaAtom = moovChildren.find((a) => a.type === 'udta');

  let udtaPos, udtaSize, newMoovSize;

  if (!udtaAtom) {
    // Create new udta atom at end of moov
    console.log('📦 Creating new udta atom...');
    udtaPos = moovAtom.offset + moovAtom.size;
    const udtaHeader = Buffer.alloc(8);
    udtaHeader.writeUInt32BE(8, 0); // size
    udtaHeader.write('udta', 4, 4, 'utf8');

    // Insert udta header
    const beforeUdta = fileBuffer.slice(0, udtaPos);
    const afterUdta = fileBuffer.slice(udtaPos);
    fileBuffer = Buffer.concat([beforeUdta, udtaHeader, afterUdta]);

    udtaSize = 8;
    // Update moov size
    newMoovSize = moovAtom.size + 8;
    fileBuffer.writeUInt32BE(newMoovSize, moovAtom.offset);
  } else {
    udtaPos = udtaAtom.offset;
    udtaSize = udtaAtom.size;
    newMoovSize = moovAtom.size;
  }

  // Create stem atom
  const stemAtomSize = 8 + stemData.length;
  const stemAtom = Buffer.alloc(stemAtomSize);
  stemAtom.writeUInt32BE(stemAtomSize, 0);
  stemAtom.write('stem', 4, 4, 'utf8');
  stemData.copy(stemAtom, 8);

  // Insert stem atom at end of udta
  const insertPos = udtaPos + udtaSize;
  const beforeStem = fileBuffer.slice(0, insertPos);
  const afterStem = fileBuffer.slice(insertPos);
  const newFileBuffer = Buffer.concat([beforeStem, stemAtom, afterStem]);

  // Update udta size
  const newUdtaSize = udtaSize + stemAtomSize;
  newFileBuffer.writeUInt32BE(newUdtaSize, udtaPos);

  // Update moov size
  newMoovSize += stemAtomSize;
  newFileBuffer.writeUInt32BE(newMoovSize, moovAtom.offset);

  // CRITICAL: Update chunk offset tables (stco/co64)
  console.log(`🔧 Updating chunk offsets: moov grew by ${stemAtomSize} bytes, data after position ${originalMoovEnd} shifted`);

  // Extract the moov atom from the new buffer for offset updating
  const moovBuffer = newFileBuffer.slice(moovAtom.offset, moovAtom.offset + newMoovSize);
  updateChunkOffsetsForStem(moovBuffer, stemAtomSize, originalMoovEnd);

  // Copy updated moov back
  moovBuffer.copy(newFileBuffer, moovAtom.offset);

  // Write back to file
  await fs.writeFile(filePath, newFileBuffer);
}

/**
 * Update chunk offset tables for stem atom injection
 * (separate function to avoid modifying the kara atom chunk offset logic)
 */
function updateChunkOffsetsForStem(moovBuffer, offsetDelta, shiftThreshold) {
  let stcoCount = 0;
  let co64Count = 0;
  let totalUpdated = 0;

  const searchAtoms = (buffer, start, end) => {
    let pos = start;

    while (pos < end - 8 && pos < buffer.length - 8) {
      try {
        const size = buffer.readUInt32BE(pos);
        if (size < 8 || size > end - pos) {
          pos += 8;
          continue;
        }

        const atype = buffer.toString('utf8', pos + 4, pos + 8);

        // Update 32-bit chunk offset table (stco)
        if (atype === 'stco') {
          stcoCount++;
          const entryCount = buffer.readUInt32BE(pos + 12);
          console.log(`  Found stco at position ${pos}, ${entryCount} entries, updating...`);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 4;
            const chunkOffset = buffer.readUInt32BE(offsetPos);

            // Only update offsets that point to data after the moov atom
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + offsetDelta;
              buffer.writeUInt32BE(newOffset, offsetPos);
              totalUpdated++;
            }
          }
        }
        // Update 64-bit chunk offset table (co64)
        else if (atype === 'co64') {
          co64Count++;
          const entryCount = buffer.readUInt32BE(pos + 12);
          console.log(`  Found co64 at position ${pos}, ${entryCount} entries, updating...`);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 8;
            const chunkOffset = Number(buffer.readBigUInt64BE(offsetPos));

            // Only update offsets that point to data after the moov atom
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + offsetDelta;
              buffer.writeBigUInt64BE(BigInt(newOffset), offsetPos);
              totalUpdated++;
            }
          }
        }
        // Recursively search container atoms
        else if (['trak', 'mdia', 'minf', 'stbl', 'moov'].includes(atype)) {
          searchAtoms(buffer, pos + 8, pos + size);
        }

        pos += size;
      } catch (error) {
        console.warn(`  Error parsing atom at ${pos}:`, error.message);
        pos += 8;
      }
    }
  };

  searchAtoms(moovBuffer, 0, moovBuffer.length);
  console.log(`✅ Chunk offset update complete: found ${stcoCount} stco + ${co64Count} co64 atoms, updated ${totalUpdated} offsets`);
}

/**
 * Inject an atom into moov/udta/meta/ilst location
 * Used for adding iTunes-compatible metadata atoms
 * @param {string} filePath - Path to MP4 file
 * @param {Buffer} atomData - Atom buffer to inject (complete atom with size+type+data)
 */
async function injectAtomToIlst(filePath, atomData) {
  // Read entire file
  const data = await fs.readFile(filePath);
  let fileBuffer = Buffer.from(data);

  // Find moov atom
  const atoms = parseMP4Atoms(fileBuffer, 0);
  const moovAtom = atoms.find((a) => a.type === 'moov');

  if (!moovAtom) {
    throw new Error('No moov atom found');
  }

  const originalMoovEnd = moovAtom.offset + moovAtom.size;

  // Find or create udta > meta > ilst chain
  const moovChildren = parseMP4Atoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
  let udtaAtom = moovChildren.find((a) => a.type === 'udta');

  let udtaPos, udtaSize;
  if (!udtaAtom) {
    // Create udta at end of moov
    console.log('  Creating udta atom...');
    udtaPos = moovAtom.offset + moovAtom.size;
    const udtaHeader = Buffer.alloc(8);
    udtaHeader.writeUInt32BE(8, 0);
    udtaHeader.write('udta', 4, 4, 'utf8');

    const beforeUdta = fileBuffer.slice(0, udtaPos);
    const afterUdta = fileBuffer.slice(udtaPos);
    fileBuffer = Buffer.concat([beforeUdta, udtaHeader, afterUdta]);

    udtaSize = 8;
    const newMoovSize = moovAtom.size + 8;
    fileBuffer.writeUInt32BE(newMoovSize, moovAtom.offset);
  } else {
    udtaPos = udtaAtom.offset;
    udtaSize = udtaAtom.size;
  }

  // Find or create meta within udta
  const udtaChildren = parseMP4Atoms(fileBuffer, udtaPos + 8, udtaSize - 8);
  let metaAtom = udtaChildren.find((a) => a.type === 'meta');

  let metaPos, metaSize;
  if (!metaAtom) {
    // Create meta at end of udta
    console.log('  Creating meta atom...');
    metaPos = udtaPos + udtaSize;

    // Meta atom has version/flags + hdlr
    const metaVersion = Buffer.alloc(4);
    metaVersion.writeUInt32BE(0, 0);

    const hdlrData = Buffer.from([
      0x00, 0x00, 0x00, 0x00, // Version/flags
      0x00, 0x00, 0x00, 0x00, // Pre-defined
      0x6d, 0x64, 0x69, 0x72, // Handler type: 'mdir'
      0x61, 0x70, 0x70, 0x6c, // Reserved: 'appl'
      0x00, 0x00, 0x00, 0x00, // Reserved
      0x00, 0x00, 0x00, 0x00, // Reserved
      0x00, // Name (empty)
    ]);
    const hdlr = createAtom('hdlr', hdlrData);

    const metaContent = Buffer.concat([metaVersion, hdlr]);
    const meta = createAtom('meta', metaContent);

    const beforeMeta = fileBuffer.slice(0, metaPos);
    const afterMeta = fileBuffer.slice(metaPos);
    fileBuffer = Buffer.concat([beforeMeta, meta, afterMeta]);

    metaSize = meta.length;

    // Update udta size
    const newUdtaSize = udtaSize + metaSize;
    fileBuffer.writeUInt32BE(newUdtaSize, udtaPos);

    // Update moov size
    const currentMoovSize = fileBuffer.readUInt32BE(moovAtom.offset);
    fileBuffer.writeUInt32BE(currentMoovSize + metaSize, moovAtom.offset);
  } else {
    metaPos = metaAtom.offset;
    metaSize = metaAtom.size;
  }

  // Find or create ilst within meta
  const metaChildren = parseMP4Atoms(fileBuffer, metaPos + 12, metaSize - 12); // Skip size+type+version+hdlr
  let ilstAtom = metaChildren.find((a) => a.type === 'ilst');

  let insertPos;
  if (!ilstAtom) {
    // Create ilst at end of meta
    console.log('  Creating ilst atom...');
    insertPos = metaPos + metaSize;

    const ilst = createAtom('ilst', atomData);

    const beforeIlst = fileBuffer.slice(0, insertPos);
    const afterIlst = fileBuffer.slice(insertPos);
    fileBuffer = Buffer.concat([beforeIlst, ilst, afterIlst]);

    const ilstSize = ilst.length;

    // Update meta size
    const newMetaSize = metaSize + ilstSize;
    fileBuffer.writeUInt32BE(newMetaSize, metaPos);

    // Update udta size
    const currentUdtaSize = fileBuffer.readUInt32BE(udtaPos);
    fileBuffer.writeUInt32BE(currentUdtaSize + ilstSize, udtaPos);

    // Update moov size
    const currentMoovSize = fileBuffer.readUInt32BE(moovAtom.offset);
    const sizeDelta = ilstSize;
    fileBuffer.writeUInt32BE(currentMoovSize + sizeDelta, moovAtom.offset);

    // Update chunk offsets
    const newMoovSize = currentMoovSize + sizeDelta;
    const moovBuffer = fileBuffer.slice(moovAtom.offset, moovAtom.offset + newMoovSize);
    updateChunkOffsetsForStem(moovBuffer, sizeDelta, originalMoovEnd);
    moovBuffer.copy(fileBuffer, moovAtom.offset);
  } else {
    // Check if an atom of the same type already exists in ilst
    // Use latin1 encoding because MP4 atom types use byte 0xA9 for ©, not UTF-8
    const atomType = atomData.toString('latin1', 4, 8);
    const ilstChildren = parseMP4Atoms(fileBuffer, ilstAtom.offset + 8, ilstAtom.size - 8);

    let existingAtom = null;

    // For freeform atoms (----), need to match by namespace+name
    if (atomType === '----') {
      const newAtomNamespace = extractFreeformNamespace(atomData);
      const newAtomName = extractFreeformName(atomData);

      existingAtom = ilstChildren.find(child => {
        if (child.type !== '----') return false;
        const childData = fileBuffer.slice(child.offset, child.offset + child.size);
        const childNamespace = extractFreeformNamespace(childData);
        const childName = extractFreeformName(childData);
        const matches = childNamespace === newAtomNamespace && childName === newAtomName;

        if (matches) {
          console.log(`  Found existing ${childNamespace}:${childName} atom, will replace`);
        }

        return matches;
      });

      if (!existingAtom) {
        console.log(`  No existing ${newAtomNamespace}:${newAtomName} atom found, will add new`);
      }
    } else {
      // For standard atoms, match by type
      existingAtom = ilstChildren.find(child => child.type === atomType);
    }

    let sizeDelta;

    if (existingAtom) {
      // Replace existing atom
      console.log(`  Replacing existing ${atomType} atom...`);

      const beforeAtom = fileBuffer.slice(0, existingAtom.offset);
      const afterAtom = fileBuffer.slice(existingAtom.offset + existingAtom.size);
      fileBuffer = Buffer.concat([beforeAtom, atomData, afterAtom]);

      sizeDelta = atomData.length - existingAtom.size;
    } else {
      // Add atom to end of existing ilst
      console.log(`  Adding new ${atomType} atom to ilst...`);
      insertPos = ilstAtom.offset + ilstAtom.size;

      const beforeAtom = fileBuffer.slice(0, insertPos);
      const afterAtom = fileBuffer.slice(insertPos);
      fileBuffer = Buffer.concat([beforeAtom, atomData, afterAtom]);

      sizeDelta = atomData.length;
    }

    // Update ilst size
    fileBuffer.writeUInt32BE(ilstAtom.size + sizeDelta, ilstAtom.offset);

    // Update meta size
    fileBuffer.writeUInt32BE(metaSize + sizeDelta, metaPos);

    // Update udta size
    const currentUdtaSize = fileBuffer.readUInt32BE(udtaPos);
    fileBuffer.writeUInt32BE(currentUdtaSize + sizeDelta, udtaPos);

    // Update moov size and chunk offsets
    const currentMoovSize = fileBuffer.readUInt32BE(moovAtom.offset);
    const newMoovSize = currentMoovSize + sizeDelta;
    fileBuffer.writeUInt32BE(newMoovSize, moovAtom.offset);

    const moovBuffer = fileBuffer.slice(moovAtom.offset, moovAtom.offset + newMoovSize);
    updateChunkOffsetsForStem(moovBuffer, sizeDelta, originalMoovEnd);
    moovBuffer.copy(fileBuffer, moovAtom.offset);
  }

  // Write back to file
  await fs.writeFile(filePath, fileBuffer);
}

/**
 * Inject a freeform atom into the ilst atom
 * (Alias for injectAtomToIlst - same implementation)
 */
const injectFreeformAtomToIlst = injectAtomToIlst;

/**
 * Extract namespace from a freeform (----) atom
 * @param {Buffer} freeformAtom - Complete ---- atom buffer
 * @returns {string} Namespace (e.g., 'com.stems', 'com.apple.iTunes')
 */
function extractFreeformNamespace(freeformAtom) {
  try {
    // Skip atom header (8 bytes)
    let offset = 8;

    // Read first child atom (should be 'mean')
    if (offset + 8 > freeformAtom.length) return null;

    const meanSize = freeformAtom.readUInt32BE(offset);
    const meanType = freeformAtom.toString('utf8', offset + 4, offset + 8);

    if (meanType !== 'mean') return null;

    // Skip mean header (8 bytes) + version/flags (4 bytes)
    const namespaceStart = offset + 12;
    const namespaceEnd = offset + meanSize;

    if (namespaceEnd > freeformAtom.length) return null;

    return freeformAtom.toString('utf8', namespaceStart, namespaceEnd);
  } catch (_error) {
    return null;
  }
}

/**
 * Extract name from a freeform (----) atom
 * @param {Buffer} freeformAtom - Complete ---- atom buffer
 * @returns {string} Name (e.g., 'kara', 'vpch', 'initialkey')
 */
function extractFreeformName(freeformAtom) {
  try {
    // Skip atom header (8 bytes)
    let offset = 8;

    // Skip 'mean' atom
    if (offset + 4 > freeformAtom.length) return null;
    const meanSize = freeformAtom.readUInt32BE(offset);
    offset += meanSize;

    // Read 'name' atom
    if (offset + 8 > freeformAtom.length) return null;
    const nameSize = freeformAtom.readUInt32BE(offset);
    const nameType = freeformAtom.toString('utf8', offset + 4, offset + 8);

    if (nameType !== 'name') return null;

    // Skip name header (8 bytes) + version/flags (4 bytes)
    const nameStart = offset + 12;
    const nameEnd = offset + nameSize;

    if (nameEnd > freeformAtom.length) return null;

    return freeformAtom.toString('utf8', nameStart, nameEnd);
  } catch (_error) {
    return null;
  }
}
