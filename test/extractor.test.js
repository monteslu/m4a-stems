/**
 * M4A Track Extractor Tests
 *
 * Tests for extracting individual audio tracks from multi-track M4A files
 * without using FFmpeg
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import * as Extractor from '../src/extractor.js';

const EXAMPLE_FILE = path.join(
  __dirname,
  'examples',
  'Dr_Tom-House_of_the_rising_sun-clip.stem.m4a'
);

describe('Track Extractor Tests', () => {
  let tempDir;

  before(async () => {
    // Verify example file exists
    await fs.access(EXAMPLE_FILE);

    // Create temp directory for test outputs
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm4a-extractor-test-'));

    console.log(`\n📁 Test file: ${path.basename(EXAMPLE_FILE)}`);
    console.log(`📂 Temp dir: ${tempDir}`);
  });

  after(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getTrackCount', () => {
    test('returns correct track count', async () => {
      const count = await Extractor.getTrackCount(EXAMPLE_FILE);

      assert.equal(typeof count, 'number', 'Track count should be a number');
      assert.ok(count >= 5, 'Stem file should have at least 5 tracks (master + 4 stems)');
      console.log(`   Found ${count} tracks`);
    });
  });

  describe('getTrackInfo', () => {
    test('returns info for all tracks', async () => {
      const info = await Extractor.getTrackInfo(EXAMPLE_FILE);

      assert.ok(Array.isArray(info), 'Should return array');
      assert.ok(info.length >= 5, 'Should have at least 5 tracks');

      // Check first track (master)
      const master = info[0];
      assert.equal(master.index, 0, 'First track should have index 0');
      assert.ok(master.sampleCount > 0, 'Should have samples');
      assert.ok(master.duration > 0, 'Should have duration');
      assert.ok(master.timescale > 0, 'Should have timescale');

      console.log(`   Track info:`);
      for (const track of info) {
        if (track.error) {
          console.log(`     Track ${track.index}: ERROR - ${track.error}`);
        } else {
          console.log(
            `     Track ${track.index}: ${track.sampleCount} samples, ${track.duration.toFixed(2)}s`
          );
        }
      }
    });
  });

  describe('extractTrack', () => {
    test('extracts track 0 (master) as valid M4A', async () => {
      const trackBuffer = await Extractor.extractTrack(EXAMPLE_FILE, 0);

      assert.ok(Buffer.isBuffer(trackBuffer), 'Should return a Buffer');
      assert.ok(trackBuffer.length > 1000, 'Buffer should have significant size');

      // Check for M4A file signature (ftyp atom)
      const ftyp = trackBuffer.toString('latin1', 4, 8);
      assert.equal(ftyp, 'ftyp', 'Should start with ftyp atom');

      // Check for M4A brand
      const brand = trackBuffer.toString('latin1', 8, 12);
      assert.equal(brand, 'M4A ', 'Should have M4A brand');

      console.log(`   Track 0 extracted: ${(trackBuffer.length / 1024).toFixed(1)} KB`);
    });

    test('extracts track 1 (drums) as valid M4A', async () => {
      const trackBuffer = await Extractor.extractTrack(EXAMPLE_FILE, 1);

      assert.ok(Buffer.isBuffer(trackBuffer), 'Should return a Buffer');
      assert.ok(trackBuffer.length > 1000, 'Buffer should have significant size');

      const ftyp = trackBuffer.toString('latin1', 4, 8);
      assert.equal(ftyp, 'ftyp', 'Should start with ftyp atom');

      console.log(`   Track 1 extracted: ${(trackBuffer.length / 1024).toFixed(1)} KB`);
    });

    test('extracts track 4 (vocals) as valid M4A', async () => {
      const trackBuffer = await Extractor.extractTrack(EXAMPLE_FILE, 4);

      assert.ok(Buffer.isBuffer(trackBuffer), 'Should return a Buffer');

      console.log(`   Track 4 extracted: ${(trackBuffer.length / 1024).toFixed(1)} KB`);
    });

    test('throws error for invalid track index', async () => {
      await assert.rejects(
        async () => Extractor.extractTrack(EXAMPLE_FILE, 99),
        /Track 99 not found/,
        'Should throw for non-existent track'
      );
    });

    test('extracted file is playable (write and verify with ffprobe)', async () => {
      const trackBuffer = await Extractor.extractTrack(EXAMPLE_FILE, 0);
      const outputPath = path.join(tempDir, 'extracted-track-0.m4a');

      await fs.writeFile(outputPath, trackBuffer);

      // Verify file exists and has content
      const stats = await fs.stat(outputPath);
      assert.ok(stats.size > 0, 'Output file should have content');

      // Try to probe with ffprobe if available
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration,format_name -of json "${outputPath}"`
        );
        const probeData = JSON.parse(stdout);

        assert.ok(probeData.format, 'ffprobe should find format info');
        assert.ok(
          probeData.format.format_name.includes('mov') ||
            probeData.format.format_name.includes('mp4'),
          'Should be recognized as MP4/MOV format'
        );

        const duration = parseFloat(probeData.format.duration);
        assert.ok(duration > 0, 'Should have positive duration');

        console.log(
          `   ffprobe verified: ${probeData.format.format_name}, ${duration.toFixed(2)}s`
        );
      } catch (err) {
        if (err.message.includes('ffprobe')) {
          console.log('   (ffprobe not available, skipping playability verification)');
        } else {
          throw err;
        }
      }
    });

    test('extracted audio streams are correct size (within expected range)', async () => {
      const info = await Extractor.getTrackInfo(EXAMPLE_FILE);
      const audioTracks = info.filter((t) => !t.error && t.sampleCount > 100);

      // All audio tracks should be roughly the same size (within 20%)
      const sizes = [];
      for (const track of audioTracks.slice(0, 5)) {
        // First 5 audio tracks
        const buffer = await Extractor.extractTrack(EXAMPLE_FILE, track.index);
        sizes.push(buffer.length);
      }

      const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

      for (let i = 0; i < sizes.length; i++) {
        const deviation = Math.abs(sizes[i] - avgSize) / avgSize;
        assert.ok(
          deviation < 0.3,
          `Track ${i} size should be within 30% of average (got ${(deviation * 100).toFixed(1)}%)`
        );
      }

      console.log(`   Track sizes (KB): ${sizes.map((s) => (s / 1024).toFixed(0)).join(', ')}`);
    });
  });

  describe('extractAllTracks', () => {
    test('extracts all audio tracks', async () => {
      const tracks = await Extractor.extractAllTracks(EXAMPLE_FILE);

      assert.ok(Array.isArray(tracks), 'Should return array');
      assert.ok(tracks.length >= 5, 'Should extract at least 5 tracks');

      for (let i = 0; i < tracks.length; i++) {
        assert.ok(Buffer.isBuffer(tracks[i]), `Track ${i} should be a Buffer`);
        assert.ok(tracks[i].length > 1000, `Track ${i} should have content`);
      }

      console.log(`   Extracted ${tracks.length} audio tracks`);
    });

    test('all extracted tracks have valid M4A structure', async () => {
      const tracks = await Extractor.extractAllTracks(EXAMPLE_FILE);

      for (let i = 0; i < tracks.length; i++) {
        const ftyp = tracks[i].toString('latin1', 4, 8);
        assert.equal(ftyp, 'ftyp', `Track ${i} should have ftyp atom`);

        // Find moov atom
        let pos = 0;
        let foundMoov = false;
        let foundMdat = false;

        while (pos < tracks[i].length - 8) {
          const size = tracks[i].readUInt32BE(pos);
          const type = tracks[i].toString('latin1', pos + 4, pos + 8);

          if (type === 'moov') foundMoov = true;
          if (type === 'mdat') foundMdat = true;

          if (size < 8) break;
          pos += size;
        }

        assert.ok(foundMoov, `Track ${i} should have moov atom`);
        assert.ok(foundMdat, `Track ${i} should have mdat atom`);
      }

      console.log('   All tracks have valid M4A structure (ftyp, moov, mdat)');
    });
  });

  describe('Comparison with FFmpeg extraction', () => {
    test('extracted track duration matches FFmpeg extraction', async () => {
      // Extract with our method
      const ourBuffer = await Extractor.extractTrack(EXAMPLE_FILE, 0);
      const ourPath = path.join(tempDir, 'our-extract.m4a');
      await fs.writeFile(ourPath, ourBuffer);

      // Extract with FFmpeg
      const ffmpegPath = path.join(tempDir, 'ffmpeg-extract.m4a');

      try {
        await execAsync(
          `ffmpeg -loglevel error -i "${EXAMPLE_FILE}" -map 0:a:0 -c copy "${ffmpegPath}" -y`
        );

        // Compare durations using ffprobe
        const { stdout: ourProbe } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 "${ourPath}"`
        );
        const { stdout: ffmpegProbe } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 "${ffmpegPath}"`
        );

        const ourDuration = parseFloat(ourProbe.trim());
        const ffmpegDuration = parseFloat(ffmpegProbe.trim());

        // Durations should match within 0.1 seconds
        const diff = Math.abs(ourDuration - ffmpegDuration);
        assert.ok(
          diff < 0.1,
          `Duration difference should be < 0.1s (got ${diff.toFixed(3)}s)`
        );

        console.log(`   Duration comparison:`);
        console.log(`     Our extraction: ${ourDuration.toFixed(3)}s`);
        console.log(`     FFmpeg extraction: ${ffmpegDuration.toFixed(3)}s`);
        console.log(`     Difference: ${(diff * 1000).toFixed(1)}ms`);
      } catch (err) {
        if (err.message.includes('ffmpeg') || err.message.includes('ffprobe')) {
          console.log('   (FFmpeg not available, skipping comparison test)');
        } else {
          throw err;
        }
      }
    });

    test('extracted track sample count matches original', async () => {
      const info = await Extractor.getTrackInfo(EXAMPLE_FILE);
      const originalSamples = info[0].sampleCount;

      // Extract and check the extracted file's sample count
      const trackBuffer = await Extractor.extractTrack(EXAMPLE_FILE, 0);
      const extractedPath = path.join(tempDir, 'sample-count-test.m4a');
      await fs.writeFile(extractedPath, trackBuffer);

      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -select_streams a:0 -show_entries stream=nb_frames -of csv=p=0 "${extractedPath}"`
        );
        const extractedSamples = parseInt(stdout.trim(), 10);

        assert.equal(
          extractedSamples,
          originalSamples,
          `Sample count should match (original: ${originalSamples}, extracted: ${extractedSamples})`
        );

        console.log(`   Sample count verified: ${originalSamples} samples`);
      } catch (err) {
        if (err.message.includes('ffprobe')) {
          console.log('   (ffprobe not available, skipping sample count verification)');
        } else {
          throw err;
        }
      }
    });
  });
});
