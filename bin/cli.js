#!/usr/bin/env node

/**
 * M4A Stems CLI
 * Dump M4A atoms and karaoke data as JSON
 */

import { parseArgs } from 'node:util';
import { readFile } from 'fs/promises';
import path from 'path';
import M4AStemsReader from '../src/reader.js';

const USAGE = `
m4a-stems - Inspect M4A Stems files and karaoke data

Usage:
  npx m4a-stems <file.m4a> [options]

Options:
  --help, -h          Show this help message
  --metadata, -m      Show only metadata
  --lyrics, -l        Show only lyrics
  --audio, -a         Show only audio sources
  --features, -f      Show only features (pitch, onsets)
  --atoms             Show raw MP4 atom tree structure
  --raw               Show raw parsed data from music-metadata
  --compact           Compact JSON output (no pretty print)

Examples:
  npx m4a-stems song.stem.m4a
  npx m4a-stems song.stem.m4a --metadata
  npx m4a-stems song.stem.m4a --lyrics --compact
  npx m4a-stems song.stem.m4a --atoms > atoms.json
  npx m4a-stems song.stem.m4a --raw > output.json
`;

async function main() {
  let args;

  try {
    args = parseArgs({
      options: {
        help: { type: 'boolean', short: 'h' },
        metadata: { type: 'boolean', short: 'm' },
        lyrics: { type: 'boolean', short: 'l' },
        audio: { type: 'boolean', short: 'a' },
        features: { type: 'boolean', short: 'f' },
        atoms: { type: 'boolean' },
        raw: { type: 'boolean' },
        compact: { type: 'boolean' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    console.error('Error parsing arguments:', err.message);
    console.error(USAGE);
    process.exit(1);
  }

  // Show help
  if (args.values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  // Check for file argument
  const filePath = args.positionals[0];
  if (!filePath) {
    console.error('Error: No file specified\n');
    console.error(USAGE);
    process.exit(1);
  }

  // Check file exists
  try {
    await readFile(filePath);
  } catch (err) {
    console.error(`Error: Cannot read file "${filePath}"`);
    console.error(err.message);
    process.exit(1);
  }

  try {
    // Determine what to show
    const showMetadata = args.values.metadata;
    const showLyrics = args.values.lyrics;
    const showAudio = args.values.audio;
    const showFeatures = args.values.features;
    const showAtoms = args.values.atoms;
    const showRaw = args.values.raw;
    const compact = args.values.compact;

    // If atoms mode, dump raw atom tree
    if (showAtoms) {
      const { dumpAtomTree } = await import('../src/atoms.js');
      const atomTree = await dumpAtomTree(filePath);
      console.log(JSON.stringify(atomTree, null, compact ? 0 : 2));
      return;
    }

    // If raw mode, use music-metadata directly
    if (showRaw) {
      const { parseFile } = await import('music-metadata');
      const rawData = await parseFile(filePath);

      // Convert to plain object for JSON serialization
      const output = {
        format: rawData.format,
        common: rawData.common,
        native: rawData.native,
      };

      console.log(JSON.stringify(output, null, compact ? 0 : 2));
      return;
    }

    // Load M4A file
    const data = await M4AStemsReader.load(filePath);

    // If no specific sections requested, show everything
    const showAll = !showMetadata && !showLyrics && !showAudio && !showFeatures;

    // Build output object
    const output = {};

    if (showAll || showMetadata) {
      output.metadata = data.metadata;
    }

    if (showAll || showAudio) {
      output.audio = data.audio;
    }

    if (showAll || showLyrics) {
      output.lyrics = data.lyrics;
    }

    if (showAll || showFeatures) {
      output.features = data.features;
    }

    // Add file info
    if (showAll) {
      output._file = {
        path: path.resolve(filePath),
        name: path.basename(filePath),
      };

      // Add preserved atoms info if present
      if (data._preservedAtoms && Object.keys(data._preservedAtoms).length > 0) {
        output._preservedAtoms = Object.keys(data._preservedAtoms);
      }
    }

    // Output JSON
    console.log(JSON.stringify(output, null, compact ? 0 : 2));

  } catch (err) {
    console.error('Error processing file:', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
