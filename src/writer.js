/**
 * M4A Stems Writer
 * Create M4A Stems files with karaoke extensions
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { generateWebVTT } from './webvtt.js';
import * as Atoms from './atoms.js';

/**
 * Execute command using spawn (handles spaces in paths correctly)
 */
async function spawnAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed: ${cmd} ${args.join(' ')}\n${stderr}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

class M4AStemsWriter {
  /**
   * Write M4A Stems file
   * @param {Object} options - Write options
   * @returns {Promise<Object>} Write results
   */
  static async write(options) {
    const {
      outputPath,
      stemsWavFiles,
      mixdownWav,
      metadata,
      lyricsData,
      analysisFeatures = null,
      profile = 'STEMS-4',
      codec = 'aac',
      bitrate = null,
      sampleRate = 44100,
      coverArt = null,
    } = options;

    console.log(`📦 Packaging stems M4A: ${outputPath}`);
    console.log(`   Profile: ${profile}, Codec: ${codec}`);

    const startTime = Date.now();

    // Auto-detect bitrate from source if not provided
    let finalBitrate = bitrate;
    if (!finalBitrate && codec === 'aac') {
      const sourceBitrate = metadata.original_bitrate || null;
      finalBitrate = this._calculateAACBitrate(sourceBitrate);
      console.log(`   Auto-detected AAC bitrate: ${finalBitrate}`);
    } else if (!finalBitrate) {
      finalBitrate = '256k';
    }

    // Create temporary working directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm4a-pack-'));

    try {
      // Step 1: Encode stems to AAC/ALAC
      console.log('Step 1: Encoding stems to AAC/ALAC...');
      const { encodedFiles, encoderDelay } = await this._encodeStems(
        stemsWavFiles,
        mixdownWav,
        tempDir,
        codec,
        finalBitrate,
        profile
      );

      // Step 2: Generate WebVTT
      console.log('Step 2: Generating WebVTT lyrics...');
      const webvttContent = generateWebVTT(lyricsData, encoderDelay, sampleRate);
      const webvttPath = path.join(tempDir, 'lyrics.vtt');
      await fs.writeFile(webvttPath, webvttContent, 'utf-8');
      console.log(`✓ WebVTT generated: ${webvttContent.length} bytes`);

      // Step 3: Mux with FFmpeg
      console.log('Step 3: Muxing multi-track M4A with FFmpeg...');
      await this._muxWithFFmpeg(encodedFiles, webvttPath, outputPath, metadata, coverArt);

      // Step 4: Generate kara atom data
      console.log('Step 4: Generating karaoke data atoms...');
      const karaData = this._generateKaraAtom(
        lyricsData,
        analysisFeatures,
        encoderDelay,
        sampleRate,
        profile
      );

      // Step 5: Write custom atoms to file
      console.log('Step 5: Writing custom atoms...');
      await Atoms.writeKaraAtom(outputPath, karaData);

      // Step 5a: Add NI Stems metadata
      console.log('Step 5a: Adding NI Stems metadata...');
      const stemNames = profile === 'STEMS-4'
        ? ['Drums', 'Bass', 'Other', 'Vocals']
        : ['Music', 'Vocals'];
      await Atoms.addNiStemsMetadata(outputPath, stemNames);

      // Step 5b: Disable tracks (stem tracks disabled by default)
      const tracksToDisable = Array.from({ length: encodedFiles.length - 1 }, (_, i) => i + 1);
      if (tracksToDisable.length > 0) {
        console.log('Step 5b: Disabling stem tracks...');
        await Atoms.disableTracks(outputPath, tracksToDisable);
      }

      // Step 5c: Write standard MP4 metadata (title, artist, album, year, genre, BPM)
      console.log('Step 5c: Writing standard metadata atoms...');
      const song = metadata.song || metadata;
      const standardMetadata = {
        title: song.title,
        artist: song.artist,
        album: song.album,
        year: song.year,
        genre: song.genre,
        tempo: song.bpm || analysisFeatures?.tempo_map?.bpm
      };
      await Atoms.addStandardMetadata(outputPath, standardMetadata);

      // Step 5d: Write musical key if available (important for DJ software)
      if (analysisFeatures && analysisFeatures.key_detection) {
        const keyInfo = analysisFeatures.key_detection;
        const detectedKey = keyInfo.key?.trim();
        const confidence = keyInfo.confidence || 0;

        if (detectedKey && detectedKey !== 'unknown' && confidence > 0.3) {
          console.log(`Step 5d: Adding musical key: ${detectedKey} (confidence: ${confidence.toFixed(2)})...`);
          await Atoms.addMusicalKey(outputPath, detectedKey);
        }
      }

      // Step 5e: Write track number if available
      if (song.track) {
        console.log('Step 5e: Adding track number...');
        await Atoms.addTrackNumber(outputPath, song.track);
      }

      // Step 5f: Write vocal pitch atom if available
      if (analysisFeatures && analysisFeatures.vocal_pitch) {
        const pitchData = analysisFeatures.vocal_pitch;

        // Transform Python format to JavaScript format if needed
        let transformedPitchData = pitchData;
        if (pitchData.quant_data && pitchData.sample_rate_hz) {
          // Python format: { quant_data: [[note, cents], ...], sample_rate_hz: 25 }
          // Convert to: { data: [{ midi, cents }, ...], sampleRate: 25 }
          transformedPitchData = {
            sampleRate: pitchData.sample_rate_hz,
            data: pitchData.quant_data.map(([midi, cents]) => ({ midi, cents }))
          };
        }

        if (transformedPitchData.data && Array.isArray(transformedPitchData.data) && transformedPitchData.data.length > 0) {
          console.log(`Step 5f: Writing vocal pitch atom (${transformedPitchData.data.length} samples)...`);
          await Atoms.writeVpchAtom(outputPath, transformedPitchData);
        }
      }

      // Step 5g: Write onsets atom if available
      // Check both 'onsets' and 'onsets_ref' keys (Python uses onsets_ref)
      const onsetsData = analysisFeatures?.onsets || analysisFeatures?.onsets_ref;
      if (onsetsData) {
        // Handle both array format and object with times field
        const onsetsArray = Array.isArray(onsetsData) ? onsetsData : onsetsData.times;

        if (Array.isArray(onsetsArray) && onsetsArray.length > 0) {
          console.log(`Step 5g: Writing onsets atom (${onsetsArray.length} onsets)...`);
          await Atoms.writeKonsAtom(outputPath, onsetsArray);
        }
      }

      // Step 6: Validate and return results
      console.log('Step 6: Validating output...');
      const stats = await fs.stat(outputPath);
      const fileHash = await this._computeFileHash(outputPath);

      const endTime = Date.now();
      const processingTime = (endTime - startTime) / 1000;

      const results = {
        success: true,
        outputFile: outputPath,
        fileSizeBytes: stats.size,
        fileSha256: fileHash,
        processingTimeSeconds: processingTime,
        profile,
        codec,
        encoderDelaySamples: encoderDelay,
      };

      console.log(`✓ M4A packaging complete: ${stats.size.toLocaleString()} bytes in ${processingTime.toFixed(1)}s`);

      return results;
    } finally {
      // Clean up temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Could not delete temp directory ${tempDir}:`, err.message);
      }
    }
  }

  /**
   * Calculate appropriate AAC bitrate based on source quality
   * @private
   */
  static _calculateAACBitrate(sourceBitrate, maxBitrate = 256000) {
    // Default to max bitrate for lossless sources or unknown
    let targetBitrate = sourceBitrate || maxBitrate;

    // Don't exceed max
    targetBitrate = Math.min(targetBitrate, maxBitrate);

    // Round to common bitrate values
    const commonBitrates = [96000, 128000, 160000, 192000, 224000, 256000, 320000];
    targetBitrate = commonBitrates.reduce((prev, curr) =>
      Math.abs(curr - targetBitrate) < Math.abs(prev - targetBitrate) ? curr : prev
    );

    // Convert to ffmpeg format (e.g., "192k")
    return `${targetBitrate / 1000}k`;
  }

  /**
   * Encode stems to AAC or ALAC
   * @private
   */
  static async _encodeStems(stemsWavFiles, mixdownWav, outputDir, codec, bitrate, profile) {
    const encodedFiles = [];
    const encoderDelay = codec === 'aac' ? 1105 : 0; // AAC has ~1105 samples delay

    // NI Stems track order: mixdown, drums, bass, other, vocals
    const stemsOrder = {
      'STEMS-4': ['mixdown', 'drums', 'bass', 'other', 'vocals'],
      'STEMS-2': ['mixdown', 'music', 'vocals'],
    };

    const orderedStems = stemsOrder[profile] || [];

    for (const stemName of orderedStems) {
      let inputWav;

      if (stemName === 'mixdown') {
        inputWav = mixdownWav;
      } else if (stemsWavFiles[stemName]) {
        inputWav = stemsWavFiles[stemName];
      } else {
        throw new Error(`Missing stem: ${stemName}`);
      }

      const outputFile = path.join(outputDir, `${stemName}.m4a`);

      let args;
      if (codec === 'aac') {
        // AAC encoding with VBR
        args = [
          '-i', inputWav,
          '-c:a', 'aac',
          '-b:a', bitrate,
          '-vbr', '4',
          '-movflags', 'faststart',
          '-y',
          outputFile,
        ];
      } else if (codec === 'alac') {
        // ALAC lossless encoding
        args = [
          '-i', inputWav,
          '-c:a', 'alac',
          '-movflags', 'faststart',
          '-y',
          outputFile,
        ];
      } else {
        throw new Error(`Unsupported codec: ${codec}`);
      }

      console.log(`→ Encoding ${stemName}.m4a (${codec})...`);
      await spawnAsync('ffmpeg', args);

      const stats = await fs.stat(outputFile);
      console.log(`  ✓ ${stemName}.m4a: ${stats.size.toLocaleString()} bytes`);

      encodedFiles.push(outputFile);
    }

    return { encodedFiles, encoderDelay };
  }

  /**
   * Mux audio tracks and WebVTT with FFmpeg
   * @private
   */
  static async _muxWithFFmpeg(audioFiles, webvttPath, outputPath, metadata, coverArt = null) {
    const args = [];

    // Add audio inputs
    for (const audioFile of audioFiles) {
      args.push('-i', audioFile);
    }

    // Add WebVTT input
    args.push('-i', webvttPath);

    // Add cover art input if provided
    let coverArtIndex = null;
    if (coverArt) {
      try {
        await fs.access(coverArt);
        args.push('-i', coverArt);
        coverArtIndex = audioFiles.length + 1; // After audio files and WebVTT
        console.log(`  Adding cover art: ${coverArt}`);
      } catch (_err) {
        console.warn(`  Cover art file not found: ${coverArt}`);
      }
    }

    // Map all audio tracks
    for (let i = 0; i < audioFiles.length; i++) {
      args.push('-map', `${i}:a`);
    }

    // Map subtitle track
    args.push('-map', `${audioFiles.length}:s`);

    // Map cover art if provided
    if (coverArtIndex !== null) {
      args.push('-map', `${coverArtIndex}:v`);
    }

    // Copy audio codecs, convert subtitle to mov_text
    args.push('-c:a', 'copy', '-c:s', 'mov_text');

    // Set cover art as attached_pic if provided
    if (coverArtIndex !== null) {
      args.push('-c:v', 'copy');
      args.push('-disposition:v:0', 'attached_pic');
    }

    // Set track 0 as default, disable others for Mixxx/Traktor compatibility
    for (let i = 0; i < audioFiles.length; i++) {
      if (i === 0) {
        args.push(`-disposition:a:${i}`, 'default');
      } else {
        args.push(`-disposition:a:${i}`, '0');
      }
    }

    // Add metadata
    const song = metadata.song || metadata;
    if (song.title) {
      args.push('-metadata', `title=${song.title}`);
    }
    if (song.artist) {
      args.push('-metadata', `artist=${song.artist}`);
    }
    if (song.album) {
      args.push('-metadata', `album=${song.album}`);
    }
    if (song.year) {
      args.push('-metadata', `date=${song.year}`);
    }
    if (song.genre) {
      args.push('-metadata', `genre=${song.genre}`);
    }

    // Move moov atom to beginning for faster parsing
    args.push('-movflags', 'faststart');

    // Output file
    args.push('-y', outputPath);

    console.log(`Running FFmpeg mux...`);
    await spawnAsync('ffmpeg', args);

    console.log('✓ FFmpeg muxing complete');
  }

  /**
   * Generate kara (Karaoke Data) atom content
   * @private
   */
  static _generateKaraAtom(lyricsData, analysisFeatures, encoderDelay, sampleRate, profile) {
    // Build sources list based on profile
    let sources;
    if (profile === 'STEMS-4') {
      sources = [
        { track: 0, id: 'mixdown', role: 'mixdown' },
        { track: 1, id: 'drums', role: 'drums' },
        { track: 2, id: 'bass', role: 'bass' },
        { track: 3, id: 'other', role: 'other' },
        { track: 4, id: 'vocals', role: 'vocals' },
      ];
    } else if (profile === 'STEMS-2') {
      sources = [
        { track: 0, id: 'mixdown', role: 'mixdown' },
        { track: 1, id: 'music', role: 'music' },
        { track: 2, id: 'vocals', role: 'vocals' },
      ];
    } else {
      sources = [];
    }

    // Build kara data
    const karaData = {
      stems_karaoke_version: '1.0',
      audio: {
        profile,
        encoder_delay_samples: encoderDelay,
        sources,
        presets: [{ id: 'karaoke', levels: { vocals: -120 } }], // Mute vocals
      },
      timing: {
        reference: 'aligned_to_vocals',
        offset_sec: 0.0,
      },
      lines: lyricsData.lines || [],
      singers: lyricsData.singers || [
        {
          id: 'A',
          name: 'Lead',
          guide_track: profile === 'STEMS-4' ? 4 : 2,
        },
      ],
    };

    return karaData;
  }

  /**
   * Compute SHA256 hash of file
   * @private
   */
  static async _computeFileHash(filePath) {
    const hash = crypto.createHash('sha256');
    const fileBuffer = await fs.readFile(filePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
  }
}

export default M4AStemsWriter;
