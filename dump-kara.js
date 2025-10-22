#!/usr/bin/env node

import { Atoms } from './src/index.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node dump-kara.js <path-to-m4a-file>');
  process.exit(1);
}

try {
  const karaData = await Atoms.readKaraAtom(filePath);

  if (!karaData) {
    console.log('No kara atom found in file');
    process.exit(0);
  }

  console.log(JSON.stringify(karaData, null, 2));
} catch (error) {
  console.error('Error reading kara atom:', error.message);
  process.exit(1);
}
