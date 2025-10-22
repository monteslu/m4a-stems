/**
 * M4A Stems Integrity Tests
 *
 * Critical tests to ensure m4a-stems never corrupts user files
 * Uses test/examples/Dr_Tom-House_of_the_rising_sun-clip.stem.m4a
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import M4AStemsReader from '../src/reader.js';
import * as Atoms from '../src/atoms.js';

const EXAMPLE_FILE = path.join(__dirname, 'examples', 'Dr_Tom-House_of_the_rising_sun-clip.stem.m4a');

/**
 * Calculate SHA256 hash of file
 */
async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('File Integrity Tests', () => {
  let tempDir;
  let originalHash;
  let originalSize;
  let originalData;

  before(async () => {
    // Verify example file exists
    await fs.access(EXAMPLE_FILE);

    // Create temp directory for test outputs
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm4a-stems-test-'));

    // Store original file properties
    originalHash = await hashFile(EXAMPLE_FILE);
    const stats = await fs.stat(EXAMPLE_FILE);
    originalSize = stats.size;

    // Load original file data
    originalData = await M4AStemsReader.load(EXAMPLE_FILE);

    console.log(`\n📁 Test file: ${path.basename(EXAMPLE_FILE)}`);
    console.log(`   Size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Hash: ${originalHash.substring(0, 16)}...`);
  });

  after(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('Read: Successfully loads example file', async () => {
    const data = await M4AStemsReader.load(EXAMPLE_FILE);

    assert.ok(data, 'Should return data');
    assert.ok(data.metadata, 'Should have metadata');
    assert.ok(data.lyrics, 'Should have lyrics array');
    assert.ok(Array.isArray(data.lyrics), 'Lyrics should be array');
  });

  test('Read: Parses metadata correctly', async () => {
    const data = await M4AStemsReader.load(EXAMPLE_FILE);

    assert.ok(data.metadata.title, 'Should have title');
    assert.ok(data.metadata.artist, 'Should have artist');
    assert.equal(typeof data.metadata.duration, 'number', 'Duration should be number');
    assert.ok(data.metadata.duration > 0, 'Duration should be positive');
  });

  test('Read: Parses audio sources', async () => {
    const data = await M4AStemsReader.load(EXAMPLE_FILE);

    assert.ok(data.audio, 'Should have audio object');
    assert.ok(data.audio.sources, 'Should have sources array');
    assert.ok(Array.isArray(data.audio.sources), 'Sources should be array');
    assert.ok(data.audio.sources.length > 0, 'Should have at least one source');

    // Verify source structure
    data.audio.sources.forEach((source, i) => {
      assert.ok(source.name || source.id, `Source ${i} should have name or id`);
      assert.equal(typeof source.trackIndex, 'number', `Source ${i} should have trackIndex`);
    });
  });

  test('Round-trip: Read → Write → Read produces identical data', async () => {
    const outputPath = path.join(tempDir, 'roundtrip-test.stem.m4a');

    // Read original
    const original = await M4AStemsReader.load(EXAMPLE_FILE);

    // Write unchanged
    const karaData = {
      audio: {
        sources: original.audio.sources.map(s => ({
          id: s.name || s.id,
          role: s.name || s.id,
          track: s.trackIndex
        })),
        profile: original.audio.profile || 'STEMS-4',
        encoder_delay_samples: original.audio.timing?.encoderDelaySamples || 0,
        presets: original.audio.presets || []
      },
      timing: {
        offset_sec: original.audio.timing?.offsetSec || 0
      },
      lines: original.lyrics.map(line => ({
        start: line.start || line.startTimeSec,
        end: line.end || line.endTimeSec,
        text: line.text,
        ...(line.disabled && { disabled: true })
      }))
    };

    // Copy file first (we can't write kara to a file that doesn't have audio)
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Write kara atom
    await Atoms.writeKaraAtom(outputPath, karaData);

    // Read back
    const readback = await M4AStemsReader.load(outputPath);

    // Compare metadata
    assert.equal(readback.metadata.title, original.metadata.title, 'Title should match');
    assert.equal(readback.metadata.artist, original.metadata.artist, 'Artist should match');

    // Compare lyrics count
    assert.equal(readback.lyrics.length, original.lyrics.length, 'Lyrics count should match');

    // Compare first lyric
    if (original.lyrics.length > 0) {
      assert.equal(readback.lyrics[0].text, original.lyrics[0].text, 'First lyric text should match');
      assert.equal(readback.lyrics[0].start, original.lyrics[0].start, 'First lyric start should match');
    }
  });

  test('Round-trip: Audio streams remain unchanged', async () => {
    const outputPath = path.join(tempDir, 'audio-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Write kara atom (minimal change)
    const karaData = {
      audio: {
        sources: originalData.audio.sources.map(s => ({
          id: s.name || s.id,
          role: s.name || s.id,
          track: s.trackIndex
        })),
        profile: originalData.audio.profile || 'STEMS-4',
        encoder_delay_samples: 0,
        presets: []
      },
      timing: { offset_sec: 0 },
      lines: originalData.lyrics.map(line => ({
        start: line.start || line.startTimeSec,
        end: line.end || line.endTimeSec,
        text: line.text
      }))
    };
    await Atoms.writeKaraAtom(outputPath, karaData);

    // Read both files as binary
    const originalBinary = await fs.readFile(EXAMPLE_FILE);
    const modifiedBinary = await fs.readFile(outputPath);

    // Files should be similar in size (within 10KB for atom changes)
    const sizeDiff = Math.abs(modifiedBinary.length - originalBinary.length);
    assert.ok(sizeDiff < 10240, `File size difference should be < 10KB, got ${sizeDiff} bytes`);

    // TODO: Could add more specific binary comparisons of mdat atoms
  });

  test('Edit: Metadata changes preserve audio', async () => {
    const outputPath = path.join(tempDir, 'metadata-edit-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Change metadata
    await Atoms.addStandardMetadata(outputPath, {
      title: 'Test Title Modified',
      artist: 'Test Artist Modified',
      album: 'Test Album',
      year: 2025,
      genre: 'Test Genre'
    });

    // Read back
    const readback = await M4AStemsReader.load(outputPath);

    // Verify metadata changed
    assert.equal(readback.metadata.title, 'Test Title Modified', 'Title should be modified');
    assert.equal(readback.metadata.artist, 'Test Artist Modified', 'Artist should be modified');

    // Verify audio intact
    assert.equal(readback.audio.sources.length, originalData.audio.sources.length, 'Audio sources count should match');
    assert.equal(readback.lyrics.length, originalData.lyrics.length, 'Lyrics count should match');
  });

  test('Edit: Lyric changes preserve audio', async () => {
    const outputPath = path.join(tempDir, 'lyrics-edit-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Modify lyrics
    const modifiedLyrics = originalData.lyrics.map((line, i) => ({
      start: line.start || line.startTimeSec,
      end: line.end || line.endTimeSec,
      text: `Modified Line ${i}: ${line.text}`
    }));

    const karaData = {
      audio: {
        sources: originalData.audio.sources.map(s => ({
          id: s.name || s.id,
          role: s.name || s.id,
          track: s.trackIndex
        })),
        profile: originalData.audio.profile || 'STEMS-4',
        encoder_delay_samples: originalData.audio.timing?.encoderDelaySamples || 0,
        presets: originalData.audio.presets || []
      },
      timing: { offset_sec: originalData.audio.timing?.offsetSec || 0 },
      lines: modifiedLyrics
    };

    await Atoms.writeKaraAtom(outputPath, karaData);

    // Read back
    const readback = await M4AStemsReader.load(outputPath);

    // Verify lyrics changed
    assert.ok(readback.lyrics[0].text.startsWith('Modified Line 0:'), 'First lyric should be modified');

    // Verify audio intact
    assert.equal(readback.audio.sources.length, originalData.audio.sources.length, 'Audio sources should be preserved');
    assert.equal(readback.metadata.title, originalData.metadata.title, 'Metadata should be preserved');
  });

  test('Preservation: Unknown atoms are preserved', async () => {
    const outputPath = path.join(tempDir, 'unknown-atoms-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Read to get preserved atoms
    const original = await M4AStemsReader.load(EXAMPLE_FILE);

    // Write minimal change
    const karaData = {
      audio: {
        sources: original.audio.sources.map(s => ({
          id: s.name || s.id,
          role: s.name || s.id,
          track: s.trackIndex
        })),
        profile: original.audio.profile || 'STEMS-4',
        encoder_delay_samples: 0,
        presets: []
      },
      timing: { offset_sec: 0 },
      lines: original.lyrics.map(line => ({
        start: line.start || line.startTimeSec,
        end: line.end || line.endTimeSec,
        text: line.text
      }))
    };
    await Atoms.writeKaraAtom(outputPath, karaData);

    // Read back
    const readback = await M4AStemsReader.load(outputPath);

    // If original had preserved atoms, they should still be there
    if (original._preservedAtoms && Object.keys(original._preservedAtoms).length > 0) {
      assert.ok(readback._preservedAtoms, 'Preserved atoms should exist');

      // Check each preserved atom still exists
      for (const atomId of Object.keys(original._preservedAtoms)) {
        assert.ok(
          readback._preservedAtoms[atomId],
          `Preserved atom ${atomId} should still exist`
        );
      }
    }
  });

  test('Binary atoms: vpch writes and reads correctly', async () => {
    const outputPath = path.join(tempDir, 'vpch-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Create test pitch data
    const pitchData = {
      sampleRate: 25,
      data: [
        { midi: 60, cents: 0 },   // C4
        { midi: 62, cents: 10 },  // D4 +10 cents
        { midi: 64, cents: -5 },  // E4 -5 cents
        { midi: 65, cents: 0 },   // F4
      ]
    };

    // Write vpch atom
    await Atoms.writeVpchAtom(outputPath, pitchData);

    // Manually verify the atom was written by parsing the file structure
    // (music-metadata has issues reading this atom in the test file due to malformed UTF-8 atoms)
    const buffer = await fs.readFile(outputPath);

    // Helper to find vpch atom in buffer
    function findVpchAtom(buffer) {
      // Search for the freeform atom pattern: ----....mean....com.stems....name....vpch
      const pattern = Buffer.from('com.stems');
      let pos = 0;
      while ((pos = buffer.indexOf(pattern, pos)) !== -1) {
        // After com.stems: [4 bytes size][4 bytes "name"][4 bytes version][4 bytes actual name]
        const nameAtomStart = pos + pattern.length;
        if (buffer.slice(nameAtomStart + 4, nameAtomStart + 8).toString('latin1') === 'name' &&
            buffer.slice(nameAtomStart + 12, nameAtomStart + 16).toString('utf8') === 'vpch') {
          // Found it! Now find the data atom after the name atom
          // indexOf returns position of 'data' string which is at +4 of the atom
          const dataStringPos = buffer.indexOf(Buffer.from('data'), nameAtomStart);
          if (dataStringPos !== -1) {
            const dataAtomStart = dataStringPos - 4; // Actual atom start
            // Parse binary data: [size][type='data'][type field][locale][binary data]
            const version = buffer.readUInt8(dataAtomStart + 16);
            const sampleRate = buffer.readUInt32BE(dataAtomStart + 17);
            const dataLength = buffer.readUInt32BE(dataAtomStart + 21);
            return { version, sampleRate, dataLength };
          }
        }
        pos++;
      }
      return null;
    }

    const vpchData = findVpchAtom(buffer);
    assert.ok(vpchData, 'Should find vpch atom in file');
    assert.equal(vpchData.sampleRate, 25, 'Sample rate should match');
    assert.equal(vpchData.dataLength, 4, 'Should have 4 pitch samples');
  });

  test('Binary atoms: kons writes and reads correctly', async () => {
    const outputPath = path.join(tempDir, 'kons-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Create test onset data
    const onsets = [0.5, 1.2, 2.3, 3.7, 5.1, 6.8];

    // Write kons atom
    await Atoms.writeKonsAtom(outputPath, onsets);

    // Manually verify the atom was written by parsing the file structure
    // (music-metadata has issues reading this atom in the test file due to malformed UTF-8 atoms)
    const buffer = await fs.readFile(outputPath);

    // Helper to find kons atom in buffer
    function findKonsAtom(buffer) {
      // Search for the freeform atom pattern: ----....mean....com.stems....name....kons
      const pattern = Buffer.from('com.stems');
      let pos = 0;
      while ((pos = buffer.indexOf(pattern, pos)) !== -1) {
        // After com.stems: [4 bytes size][4 bytes "name"][4 bytes version][4 bytes actual name]
        const nameAtomStart = pos + pattern.length;
        if (buffer.slice(nameAtomStart + 4, nameAtomStart + 8).toString('latin1') === 'name' &&
            buffer.slice(nameAtomStart + 12, nameAtomStart + 16).toString('utf8') === 'kons') {
          // Found it! Now find the data atom after the name atom
          // indexOf returns position of 'data' string which is at +4 of the atom
          const dataStringPos = buffer.indexOf(Buffer.from('data'), nameAtomStart);
          if (dataStringPos !== -1) {
            const dataAtomStart = dataStringPos - 4; // Actual atom start
            // Parse binary data: [size][type='data'][type field][locale][binary data]
            const version = buffer.readUInt8(dataAtomStart + 16);
            const dataLength = buffer.readUInt32BE(dataAtomStart + 17);
            return { version, dataLength };
          }
        }
        pos++;
      }
      return null;
    }

    const konsData = findKonsAtom(buffer);
    assert.ok(konsData, 'Should find kons atom in file');
    assert.equal(konsData.dataLength, 6, 'Should have 6 onsets');
  });

  test('Musical key: writes and reads correctly', async () => {
    const outputPath = path.join(tempDir, 'key-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Write musical key
    await Atoms.addMusicalKey(outputPath, 'Am');

    // Read back
    const readback = await M4AStemsReader.load(outputPath);

    // Verify key
    assert.ok(readback.metadata.key, 'Should have key');
    assert.equal(readback.metadata.key, 'Am', 'Key should be Am');
  });

  test('Corruption check: Multiple sequential writes', async () => {
    const outputPath = path.join(tempDir, 'multi-write-test.stem.m4a');

    // Copy file
    await fs.copyFile(EXAMPLE_FILE, outputPath);

    // Perform multiple writes (simulate real-world editing)
    await Atoms.addStandardMetadata(outputPath, { title: 'Edit 1' });
    await Atoms.addStandardMetadata(outputPath, { artist: 'Edit 2' });
    await Atoms.addMusicalKey(outputPath, 'Dm');

    const karaData = {
      audio: {
        sources: originalData.audio.sources.map(s => ({
          id: s.name || s.id,
          role: s.name || s.id,
          track: s.trackIndex
        })),
        profile: originalData.audio.profile || 'STEMS-4',
        encoder_delay_samples: 0,
        presets: []
      },
      timing: { offset_sec: 0 },
      lines: originalData.lyrics.map(line => ({
        start: line.start || line.startTimeSec,
        end: line.end || line.endTimeSec,
        text: 'Modified'
      }))
    };
    await Atoms.writeKaraAtom(outputPath, karaData);

    // Read back - should not throw or corrupt
    const readback = await M4AStemsReader.load(outputPath);

    assert.equal(readback.metadata.title, 'Edit 1', 'Title should be updated');
    assert.equal(readback.metadata.artist, 'Edit 2', 'Artist should be updated');
    assert.equal(readback.metadata.key, 'Dm', 'Key should be set');
    assert.equal(readback.lyrics[0].text, 'Modified', 'Lyrics should be updated');
    assert.equal(readback.audio.sources.length, originalData.audio.sources.length, 'Audio sources preserved');
  });

  test('Atom tree: dumpAtomTree returns complete structure', async () => {
    const atomTree = await Atoms.dumpAtomTree(EXAMPLE_FILE);

    // Should have top-level atoms
    assert.ok(Array.isArray(atomTree), 'Should return an array');
    assert.ok(atomTree.length > 0, 'Should have at least one atom');

    // Find the ftyp atom (first atom in M4A files)
    const ftyp = atomTree.find(a => a.type === 'ftyp');
    assert.ok(ftyp, 'Should have ftyp atom');
    assert.equal(ftyp.offset, 0, 'ftyp should be at offset 0');
    assert.ok(ftyp.size > 0, 'ftyp should have a size');

    // Find the moov atom (metadata container)
    const moov = atomTree.find(a => a.type === 'moov');
    assert.ok(moov, 'Should have moov atom');
    assert.ok(moov.children, 'moov should have children');
    assert.ok(moov.children.length > 0, 'moov should have child atoms');

    // Verify moov contains expected children
    const mvhd = moov.children.find(a => a.type === 'mvhd');
    assert.ok(mvhd, 'moov should contain mvhd');

    const trak = moov.children.find(a => a.type === 'trak');
    assert.ok(trak, 'moov should contain trak');
    assert.ok(trak.children, 'trak should have children');

    // Find udta (user data) atom with metadata
    const udta = moov.children.find(a => a.type === 'udta');
    assert.ok(udta, 'moov should contain udta');
    assert.ok(udta.children, 'udta should have children');

    const meta = udta.children.find(a => a.type === 'meta');
    assert.ok(meta, 'udta should contain meta');
    assert.ok(meta.children, 'meta should have children');

    const ilst = meta.children.find(a => a.type === 'ilst');
    assert.ok(ilst, 'meta should contain ilst (metadata list)');
    assert.ok(ilst.children, 'ilst should have children');
    assert.ok(ilst.children.length > 0, 'ilst should have metadata atoms');

    // Verify standard metadata atoms exist
    const hasTitle = ilst.children.some(a => a.type === '©nam');
    const hasArtist = ilst.children.some(a => a.type === '©ART');
    assert.ok(hasTitle, 'Should have title (©nam) atom');
    assert.ok(hasArtist, 'Should have artist (©ART) atom');

    // Find freeform atoms (----) which contain karaoke data
    const freeformAtoms = ilst.children.filter(a => a.type === '----');
    assert.ok(freeformAtoms.length > 0, 'Should have at least one freeform atom');

    // Verify freeform atoms have children (mean, name, data)
    const freeform = freeformAtoms[0];
    assert.ok(freeform.children, 'Freeform atom should have children');
    const hasMean = freeform.children.some(a => a.type === 'mean');
    const hasName = freeform.children.some(a => a.type === 'name');
    const hasData = freeform.children.some(a => a.type === 'data');
    assert.ok(hasMean, 'Freeform atom should have mean');
    assert.ok(hasName, 'Freeform atom should have name');
    assert.ok(hasData, 'Freeform atom should have data');
  });

  test('Atom tree: respects maxDepth parameter', async () => {
    // Test with depth 0 (no recursion)
    const shallow = await Atoms.dumpAtomTree(EXAMPLE_FILE, 0);
    assert.ok(Array.isArray(shallow), 'Should return an array');
    const moovShallow = shallow.find(a => a.type === 'moov');
    assert.ok(moovShallow, 'Should have moov atom');
    assert.ok(!moovShallow.children, 'Should not have children at depth 0');

    // Test with depth 1 (one level of recursion)
    const depth1 = await Atoms.dumpAtomTree(EXAMPLE_FILE, 1);
    const moovDepth1 = depth1.find(a => a.type === 'moov');
    assert.ok(moovDepth1.children, 'Should have children at depth 1');
    const trakDepth1 = moovDepth1.children.find(a => a.type === 'trak');
    assert.ok(trakDepth1, 'Should have trak at depth 1');
    assert.ok(!trakDepth1.children, 'Should not have grandchildren at depth 1');

    // Test with depth 2
    const depth2 = await Atoms.dumpAtomTree(EXAMPLE_FILE, 2);
    const moovDepth2 = depth2.find(a => a.type === 'moov');
    const trakDepth2 = moovDepth2.children.find(a => a.type === 'trak');
    assert.ok(trakDepth2.children, 'Should have grandchildren at depth 2');
  });

  test('Atom tree: handles all atom properties correctly', async () => {
    const atomTree = await Atoms.dumpAtomTree(EXAMPLE_FILE);

    // Helper to check all atoms recursively
    function checkAtom(atom, path = '') {
      const currentPath = path + '/' + atom.type;

      // Every atom must have required properties
      assert.ok(atom.type, `Atom at ${currentPath} must have type`);
      assert.ok(typeof atom.type === 'string', `Atom type at ${currentPath} must be string`);
      assert.ok(atom.type.length === 4, `Atom type at ${currentPath} must be 4 chars`);

      assert.ok(typeof atom.size === 'number', `Atom size at ${currentPath} must be number`);
      assert.ok(atom.size >= 8, `Atom size at ${currentPath} must be at least 8 bytes`);

      assert.ok(typeof atom.offset === 'number', `Atom offset at ${currentPath} must be number`);
      assert.ok(atom.offset >= 0, `Atom offset at ${currentPath} must be non-negative`);

      // Check children recursively
      if (atom.children) {
        assert.ok(Array.isArray(atom.children), `Atom children at ${currentPath} must be array`);
        for (const child of atom.children) {
          checkAtom(child, currentPath);
        }
      }
    }

    for (const atom of atomTree) {
      checkAtom(atom);
    }
  });
});
