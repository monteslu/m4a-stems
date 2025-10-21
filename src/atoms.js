/**
 * Custom MP4 Atom Handling
 * Write and read custom atoms for karaoke extensions
 *
 * This module provides low-level MP4 atom manipulation for writing
 * custom karaoke data to M4A files.
 */

import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Custom atom names
export const ATOM_NAMES = {
  KAID: '----:com.stems:kaid',  // Karaoke Data (JSON)
  VPCH: '----:com.stems:vpch',  // Vocal Pitch (binary)
  KONS: '----:com.stems:kons',  // Karaoke Onsets (binary)
  NI_STEMS: '----:com.native-instruments:stems',  // NI Stems metadata
};

/**
 * Write kaid (Karaoke Data) atom to MP4 file
 * Uses ffmpeg to write custom freeform metadata
 * @param {string} filePath - Path to MP4 file
 * @param {Object} kaidData - Karaoke data to write
 */
export async function writeKaidAtom(filePath, kaidData) {
  try {
    // Convert data to JSON string
    const jsonData = JSON.stringify(kaidData, null, 0);

    // Use ffmpeg to write custom metadata
    // Note: This writes to iTunes-style freeform atoms
    const tempFile = `${filePath}.tmp.m4a`;
    const cmd = `ffmpeg -i "${filePath}" -movflags use_metadata_tags -metadata "com.stems:kaid=${jsonData}" -c copy "${tempFile}" -y`;

    await execAsync(cmd);

    // Replace original with temp file
    await fs.promises.unlink(filePath);
    await fs.promises.rename(tempFile, filePath);

    console.log(`✓ kaid atom written (${jsonData.length} bytes)`);
  } catch (error) {
    throw new Error(`Failed to write kaid atom: ${error.message}`);
  }
}

/**
 * Write vpch (Vocal Pitch) atom to MP4 file
 * Binary format:
 * - Version (1 byte): 0x01
 * - Sample rate (4 bytes, big-endian): e.g., 25 Hz
 * - Data length (4 bytes, big-endian): number of samples
 * - Pitch data (2 bytes per sample, big-endian):
 *   - MIDI note (1 byte): 0-127
 *   - Cents offset (1 byte signed): -50 to +50
 *
 * @param {string} filePath - Path to MP4 file
 * @param {Object} pitchData - Pitch data object with sampleRate and data array
 */
export async function writeVpchAtom(filePath, pitchData) {
  try {
    const { sampleRate = 25, data } = pitchData;

    // Build binary buffer
    const dataLength = data.length;
    const bufferSize = 1 + 4 + 4 + (dataLength * 2); // version + sampleRate + length + data
    const buffer = Buffer.alloc(bufferSize);

    let offset = 0;

    // Version
    buffer.writeUInt8(1, offset);
    offset += 1;

    // Sample rate (big-endian)
    buffer.writeUInt32BE(sampleRate, offset);
    offset += 4;

    // Data length (big-endian)
    buffer.writeUInt32BE(dataLength, offset);
    offset += 4;

    // Pitch data
    for (const sample of data) {
      // MIDI note
      buffer.writeUInt8(sample.midi || 0, offset);
      offset += 1;

      // Cents offset (signed)
      buffer.writeInt8(sample.cents || 0, offset);
      offset += 1;
    }

    // Write using direct file manipulation or external tool
    // For now, we'll use a placeholder approach
    // TODO: Implement binary atom writing using direct MP4 manipulation
    console.log(`✓ vpch atom prepared (${buffer.length} bytes, ${dataLength} samples)`);
    console.warn('⚠️  Binary atom writing not yet fully implemented - use Python converter for now');

  } catch (error) {
    throw new Error(`Failed to write vpch atom: ${error.message}`);
  }
}

/**
 * Write kons (Karaoke Onsets) atom to MP4 file
 * Binary format:
 * - Version (1 byte): 0x01
 * - Data length (4 bytes, big-endian): number of onsets
 * - Onset times (4 bytes per onset, big-endian): milliseconds
 *
 * @param {string} filePath - Path to MP4 file
 * @param {Array<number>} onsetsData - Array of onset times in seconds
 */
export async function writeKonsAtom(filePath, onsetsData) {
  try {
    const dataLength = onsetsData.length;
    const bufferSize = 1 + 4 + (dataLength * 4); // version + length + data
    const buffer = Buffer.alloc(bufferSize);

    let offset = 0;

    // Version
    buffer.writeUInt8(1, offset);
    offset += 1;

    // Data length (big-endian)
    buffer.writeUInt32BE(dataLength, offset);
    offset += 4;

    // Onset times (convert seconds to milliseconds)
    for (const onset of onsetsData) {
      const timeMs = Math.round(onset * 1000);
      buffer.writeUInt32BE(timeMs, offset);
      offset += 4;
    }

    // Write using direct file manipulation or external tool
    // For now, we'll use a placeholder approach
    // TODO: Implement binary atom writing using direct MP4 manipulation
    console.log(`✓ kons atom prepared (${buffer.length} bytes, ${dataLength} onsets)`);
    console.warn('⚠️  Binary atom writing not yet fully implemented - use Python converter for now');

  } catch (error) {
    throw new Error(`Failed to write kons atom: ${error.message}`);
  }
}

/**
 * Add NI Stems metadata to MP4 file
 * @param {string} filePath - Path to MP4 file
 * @param {Array<string>} stemNames - Array of stem names (default: Drums, Bass, Other, Vocals)
 */
export async function addNiStemsMetadata(filePath, stemNames = null) {
  try {
    if (!stemNames) {
      stemNames = ['Drums', 'Bass', 'Other', 'Vocals'];
    }

    // Default colors for each stem
    const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];

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

    // TODO: Implement direct binary injection of stem atom to moov/udta/stem
    // For now, this is a placeholder
    console.log(`✓ NI Stems metadata prepared (${stemNames.length} stems)`);
    console.warn('⚠️  NI Stems atom injection not yet fully implemented - use Python converter for now');

  } catch (error) {
    throw new Error(`Failed to add NI Stems metadata: ${error.message}`);
  }
}

/**
 * Disable specific audio tracks in MP4 file
 * Sets track header flags so only the mixdown plays by default
 *
 * @param {string} filePath - Path to MP4 file
 * @param {Array<number>} trackIndices - Indices of tracks to disable (0-based)
 */
export async function disableTracks(filePath, trackIndices) {
  console.log(`Track disabling not yet implemented - skipping tracks ${trackIndices.join(', ')}`);
  console.log('All tracks will remain enabled');
  // TODO: Implement track disabling using ffmpeg -disposition or direct binary editing
}

/**
 * Get karaoke features from an M4A file
 * Fast check for what karaoke features are present
 *
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

    // Check for kaid atom (lyrics)
    if (metadata.native?.iTunes) {
      const kaidAtom = metadata.native.iTunes.find((tag) => tag.id === ATOM_NAMES.KAID);

      if (kaidAtom) {
        features.has_lyrics = true;

        // Parse to check for word timing
        try {
          const kaidData = JSON.parse(kaidAtom.value);
          const lines = kaidData.lines || [];
          features.has_word_timing = lines.some((line) => 'word_timing' in line);

          // Check for multiple singers
          const singers = kaidData.singers || [];
          if (singers.length > 1) {
            features.has_advanced = true;
          }
        } catch (err) {
          console.warn('Could not parse kaid data:', err.message);
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
