/**
 * M4A Stems Reader
 * Load and parse M4A Stems files with karaoke extensions
 */

import { parseFile } from 'music-metadata';
import { readFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';

const execAsync = promisify(exec);

class M4AStemsReader {
  /**
   * Extract a single audio track from M4A file using FFmpeg
   * @param {string} m4aPath - Path to M4A file
   * @param {number} trackIndex - Track index (0-based)
   * @returns {Promise<Buffer>} Audio data as buffer
   */
  static async extractTrack(m4aPath, trackIndex) {
    try {
      // Create temporary file for extracted track
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `track_${trackIndex}_${Date.now()}.m4a`);

      // Use FFmpeg to extract the specific track
      // -map 0:a:{trackIndex} selects the audio track at the given index
      // -loglevel error suppresses verbose output
      const ffmpegCmd = `ffmpeg -loglevel error -i "${m4aPath}" -map 0:a:${trackIndex} -c copy "${tempFile}" -y`;

      const { stderr } = await execAsync(ffmpegCmd);

      if (stderr) {
        console.warn(`⚠️  FFmpeg warning for track ${trackIndex}:`, stderr);
      }

      // Read the extracted audio file
      const audioBuffer = await fs.promises.readFile(tempFile);

      // Clean up temporary file
      try {
        await fs.promises.unlink(tempFile);
      } catch (unlinkErr) {
        console.warn(`Could not delete temp file ${tempFile}:`, unlinkErr.message);
      }

      return audioBuffer;
    } catch (error) {
      // Check if FFmpeg is not installed
      if (error.message.includes('ffmpeg') && error.message.includes('not found')) {
        throw new Error('FFmpeg is not installed. Please install FFmpeg to extract M4A tracks.');
      }
      throw new Error(`Failed to extract track ${trackIndex}: ${error.message}`);
    }
  }

  /**
   * Extract all audio tracks from M4A file
   * @param {string} m4aPath - Path to M4A file
   * @param {Array} sources - Array of source definitions with trackIndex
   * @returns {Promise<Map>} Map of track name to audio buffer
   */
  static async extractAllTracks(m4aPath, sources) {
    const audioFiles = new Map();

    for (const source of sources) {
      try {
        const audioBuffer = await this.extractTrack(m4aPath, source.track);
        audioFiles.set(source.role || source.id, audioBuffer);
      } catch (error) {
        console.warn(
          `⚠️  Failed to extract track ${source.track} (${source.role || source.id}):`,
          error.message
        );
        // Continue with other tracks even if one fails
      }
    }

    return audioFiles;
  }

  /**
   * Load and parse M4A Stems file with karaoke extensions
   * @param {string} m4aPath - Path to .stem.m4a file
   * @returns {Promise<Object>} Parsed M4A data
   */
  static async load(m4aPath) {
    try {
      // Parse metadata using music-metadata
      const mmData = await parseFile(m4aPath);

      // Extract kara atom (karaoke data)
      let karaData = null;
      if (mmData.native?.iTunes) {
        const karaAtom = mmData.native.iTunes.find((tag) => tag.id === '----:com.stems:kara');

        if (karaAtom?.value) {
          try {
            karaData = JSON.parse(karaAtom.value);
          } catch (parseErr) {
            console.warn('❌ Could not parse kara atom:', parseErr.message);
          }
        }
      }

      // Extract vocal pitch atom (vpch)
      let vocalPitch = null;
      if (mmData.native?.iTunes) {
        const vpchAtom = mmData.native.iTunes.find((tag) => tag.id === '----:com.stems:vpch');
        if (vpchAtom?.value) {
          vocalPitch = this._parseVpchAtom(vpchAtom.value);
        }
      }

      // Extract onsets atom (kons)
      let onsets = null;
      if (mmData.native?.iTunes) {
        const konsAtom = mmData.native.iTunes.find((tag) => tag.id === '----:com.stems:kons');
        if (konsAtom?.value) {
          onsets = this._parseKonsAtom(konsAtom.value);
        }
      }

      // If no kara atom found, create default structure
      if (!karaData) {
        console.warn('⚠️  M4A file does not contain kara atom - creating default structure');

        // Get track count from format (fallback to stereo)
        const trackCount = mmData.format?.numberOfChannels || 2;

        // Create default audio sources
        const defaultSources = [];
        for (let i = 0; i < trackCount; i++) {
          defaultSources.push({
            id: `track${i}`,
            role: `track${i}`,
            track: i,
          });
        }

        // Create minimal kara structure
        karaData = {
          audio: {
            sources: defaultSources,
            profile: 'STEMS-2',
            encoder_delay_samples: 0,
          },
          lines: [],
          singers: [],
        };
      }

      // Extract musical key from iTunes metadata
      let musicalKey = null;
      if (mmData.native?.iTunes) {
        const keyAtom = mmData.native.iTunes.find(
          (tag) => tag.id === '----:com.apple.iTunes:initialkey'
        );
        if (keyAtom?.value) {
          // Value is typically a Buffer, convert to string
          const keyString =
            typeof keyAtom.value === 'string'
              ? keyAtom.value
              : Buffer.isBuffer(keyAtom.value)
                ? keyAtom.value.toString('utf-8')
                : String(keyAtom.value);
          musicalKey = keyString.trim();
        }
      }

      // Extract standard metadata
      const metadata = {
        title: mmData.common?.title || path.basename(m4aPath, path.extname(m4aPath)),
        artist: mmData.common?.artist || '',
        album: mmData.common?.album || '',
        duration: mmData.format?.duration || 0,
        key: musicalKey,
        tempo: karaData.meter?.bpm || mmData.common?.bpm || null,
        genre: mmData.common?.genre?.[0] || '',
        year: mmData.common?.year || null,
      };

      // Build audio sources from kara data (without extracting audio yet)
      const sources = [];
      if (karaData.audio?.sources) {
        for (const source of karaData.audio.sources) {
          sources.push({
            name: source.role || source.id,
            filename: `track_${source.track}.m4a`,
            gain: source.gain || 0,
            pan: source.pan || 0,
            solo: source.solo || false,
            mute: source.mute || false,
            trackIndex: source.track,
            audioData: null, // Not extracted by default
          });
        }
      }

      // Extract lyrics from kara data
      let lyrics = null;
      if (karaData.lines?.length > 0) {
        lyrics = [...karaData.lines].sort((a, b) => (a.start || 0) - (b.start || 0));
      }

      // Build return structure
      return {
        metadata,

        audio: {
          sources,
          presets: karaData.audio?.presets || [],
          timing: {
            offsetSec: karaData.timing?.offset_sec || 0,
            encoderDelaySamples: karaData.audio?.encoder_delay_samples || 0,
          },
          profile: karaData.audio?.profile || 'STEMS-4',
        },

        lyrics,

        features: {
          vocalPitch,
          onsets,
        },
      };
    } catch (error) {
      throw new Error(`Failed to load M4A file: ${error.message}`);
    }
  }

  /**
   * Parse vocal pitch atom (vpch)
   * Binary format:
   * - Version (1 byte): 0x01
   * - Sample rate (4 bytes, big-endian): e.g., 25 Hz
   * - Data length (4 bytes, big-endian): number of samples
   * - Pitch data (2 bytes per sample, big-endian):
   *   - MIDI note (1 byte): 0-127
   *   - Cents offset (1 byte signed): -50 to +50
   */
  static _parseVpchAtom(buffer) {
    try {
      const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

      if (data.length < 9) {
        return null;
      }

      const version = data.readUInt8(0);
      if (version !== 1) {
        console.warn(`Unknown vpch version: ${version}`);
        return null;
      }

      const sampleRate = data.readUInt32BE(1);
      const dataLength = data.readUInt32BE(5);

      const pitchData = [];
      let offset = 9;

      for (let i = 0; i < dataLength && offset + 1 < data.length; i++) {
        const midiNote = data.readUInt8(offset);
        const centsOffset = data.readInt8(offset + 1);

        pitchData.push({
          midi: midiNote,
          cents: centsOffset,
          frequency: midiNote > 0 ? 440 * Math.pow(2, (midiNote - 69 + centsOffset / 100) / 12) : 0,
        });

        offset += 2;
      }

      return {
        sampleRate,
        data: pitchData,
      };
    } catch (error) {
      console.warn('Failed to parse vpch atom:', error.message);
      return null;
    }
  }

  /**
   * Parse karaoke onsets atom (kons)
   * Binary format:
   * - Version (1 byte): 0x01
   * - Data length (4 bytes, big-endian): number of onsets
   * - Onset times (4 bytes per onset, big-endian): milliseconds
   */
  static _parseKonsAtom(buffer) {
    try {
      const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

      if (data.length < 5) {
        return null;
      }

      const version = data.readUInt8(0);
      if (version !== 1) {
        console.warn(`Unknown kons version: ${version}`);
        return null;
      }

      const dataLength = data.readUInt32BE(1);
      const onsets = [];
      let offset = 5;

      for (let i = 0; i < dataLength && offset + 3 < data.length; i++) {
        const timeMs = data.readUInt32BE(offset);
        onsets.push(timeMs / 1000); // Convert to seconds
        offset += 4;
      }

      return onsets;
    } catch (error) {
      console.warn('Failed to parse kons atom:', error.message);
      return null;
    }
  }

  /**
   * Get karaoke features from an M4A file (quick metadata-only read)
   * @param {string} m4aPath - Path to M4A file
   * @returns {Promise<Object>} Karaoke features (lyrics, pitch, onsets)
   */
  static async getKaraokeFeatures(m4aPath) {
    const data = await this.load(m4aPath);
    return {
      lyrics: data.lyrics,
      vocalPitch: data.features.vocalPitch,
      onsets: data.features.onsets,
      metadata: data.metadata,
    };
  }
}

export default M4AStemsReader;
