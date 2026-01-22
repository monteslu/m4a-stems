# m4a-stems

[![Tests](https://github.com/monteslu/m4a-stems/actions/workflows/test.yml/badge.svg)](https://github.com/monteslu/m4a-stems/actions/workflows/test.yml)
[![npm version](https://badge.fury.io/js/m4a-stems.svg)](https://www.npmjs.com/package/m4a-stems)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Read and write multi-track M4A Stems files with karaoke extensions.

**Perfect for karaoke applications** - Store backing tracks and synchronized lyrics in a single file format compatible with DJ software like Traktor and Mixxx.

## Features

- 🎵 **Multi-track Audio** - Read/write M4A files with 5 AAC tracks (master + 4 stems)
- 🎤 **Karaoke Lyrics** - Synchronized lyrics with word-level timing
- 🎹 **Musical Metadata** - Key detection, BPM, vocal pitch tracking
- 🎛️ **NI Stems Compatible** - Works with Traktor, Mixxx, and other DJ software
- 🔧 **FFmpeg-free Extraction** - Extract tracks in pure JS (no external dependencies)
- 🏭 **FFmpeg-based Writing** - Create stem files from WAV sources
- 📝 **iTunes Compatible** - Standard metadata atoms (title, artist, album)
- 🌐 **Isomorphic Extractor** - Works in both Node.js and browsers

## Installation

```bash
npm install m4a-stems
```

**Requirements:**
- Node.js >= 18.0.0

## File Format

This library works with `.stem.mp4` or `.stem.m4a` files that follow the [NI Stems specification](https://www.native-instruments.com/en/specials/stems/) with karaoke extensions.

> **Note:** The official NI spec uses `.stem.mp4`, but `.stem.m4a` is equally valid since both are MP4 containers. Use `.stem.mp4` for maximum DJ software compatibility (Traktor, etc.), or `.stem.m4a` if targeting audio applications.

### Audio Tracks

| Track | Content | Purpose |
|-------|---------|---------|
| 0 | Master | Full mix (plays in normal audio players) |
| 1 | Drums | Rhythm, percussion |
| 2 | Bass | Low-end, basslines |
| 3 | Other | Melody, instruments, synths |
| 4 | Vocals | Vocals (mute for karaoke) |

### Metadata Structure

The format uses two metadata locations:

1. **`stem` atom** (`moov/udta/stem`) - NI Stems metadata for DJ software compatibility
2. **`kara` atom** (`moov/udta/meta/ilst/----:com.stems:kara`) - Karaoke lyrics and timing

This dual approach means files work in both DJ software and karaoke applications.

## Quick Start

### Extract Audio Tracks (No FFmpeg Required)

The Extractor works with binary data - you handle the I/O, the library handles the extraction.

**Accepted input types:**
- `Uint8Array` - works everywhere
- `ArrayBuffer` - works everywhere (e.g., from `fetch`)
- Node.js `Buffer` - works in Node.js only

#### Node.js Usage

```javascript
import * as Extractor from 'm4a-stems/extractor';
import fs from 'fs/promises';

// Read the file yourself
const fileData = await fs.readFile('song.stem.m4a');

// Extract tracks (synchronous, returns Uint8Array)
const trackBuffer = Extractor.extractTrack(fileData, 0);
const allTracks = Extractor.extractAllTracks(fileData);
const info = Extractor.getTrackInfo(fileData);
const count = Extractor.getTrackCount(fileData);
```

#### Browser Usage

```javascript
import * as Extractor from 'm4a-stems/extractor';

// Fetch the file yourself
const response = await fetch('song.stem.m4a');
const arrayBuffer = await response.arrayBuffer();

// Extract tracks (synchronous, returns Uint8Array)
const trackBuffer = Extractor.extractTrack(arrayBuffer, 0);
const allTracks = Extractor.extractAllTracks(arrayBuffer);
```

#### Browser with Web Audio API

```javascript
import * as Extractor from 'm4a-stems/extractor';

// Fetch stems file
const response = await fetch('song.stem.m4a');
const arrayBuffer = await response.arrayBuffer();

// Extract all tracks as separate M4A buffers
const tracks = Extractor.extractAllTracks(arrayBuffer);

// Decode each track with Web Audio API
const audioContext = new AudioContext();
const audioBuffers = await Promise.all(
  tracks.map(track => audioContext.decodeAudioData(track.buffer))
);

// Now you have 5 AudioBuffers: master, drums, bass, other, vocals
```

### Read Metadata and Lyrics

```javascript
import { M4AStemsReader, Atoms } from 'm4a-stems';

// Full file load
const data = await M4AStemsReader.load('song.stem.m4a');

console.log(data.metadata.title);     // "Song Title"
console.log(data.metadata.artist);    // "Artist Name"
console.log(data.metadata.key);       // "Am"
console.log(data.metadata.duration);  // 180.5 (seconds)

// Access lyrics with timing
console.log(data.lyrics);
// [
//   { start: 0.5, end: 2.0, text: 'First line', words: { timings: [[0, 0.3], [0.4, 0.8]] } },
//   { start: 2.5, end: 4.0, text: 'Second line' }
// ]

// Or read atoms directly
const stems = await Atoms.readNiStemsMetadata('song.stem.m4a');
// { version: 1, mastering_dsp: {...}, stems: [{name: 'drums', color: '#FF0000'}, ...] }

const kara = await Atoms.readKaraAtom('song.stem.m4a');
// { timing: {...}, lines: [...], singers: {...} }
```

### Write Metadata

```javascript
import { Atoms } from 'm4a-stems';

// Add NI Stems metadata (for DJ software)
await Atoms.addNiStemsMetadata('song.stem.m4a', ['drums', 'bass', 'other', 'vocals']);

// Add karaoke data
await Atoms.writeKaraAtom('song.stem.m4a', {
  timing: { offset_sec: 0 },
  lines: [
    {
      start: 0.5,
      end: 2.0,
      text: 'Hello world',
      words: { timings: [[0, 0.4], [0.5, 1.0]] }  // Word-level timing
    }
  ]
});

// Add standard metadata
await Atoms.addStandardMetadata('song.stem.m4a', {
  title: 'Song Title',
  artist: 'Artist Name',
  album: 'Album Name',
  year: 2024,
  genre: 'Rock',
  tempo: 120
});

// Add musical key
await Atoms.addMusicalKey('song.stem.m4a', 'Am');
```

### Create New Stem Files (Requires FFmpeg)

The Writer requires FFmpeg to encode WAV files to AAC and mux the multi-track container.

```javascript
import { M4AStemsWriter } from 'm4a-stems';

await M4AStemsWriter.write({
  outputPath: 'output.stem.m4a',

  // Audio stems (WAV files to be encoded to AAC)
  stemsWavFiles: {
    vocals: 'tracks/vocals.wav',
    drums: 'tracks/drums.wav',
    bass: 'tracks/bass.wav',
    other: 'tracks/other.wav',
  },

  // Full mix for backward compatibility
  mixdownWav: 'tracks/mixdown.wav',

  // Metadata
  metadata: {
    title: 'Song Title',
    artist: 'Artist Name',
    key: 'Am',
    tempo: 120,
  },

  // Karaoke lyrics
  lyricsData: {
    lines: [
      { start: 0.5, end: 2.0, text: 'First line of lyrics' },
      { start: 2.5, end: 4.0, text: 'Second line of lyrics' },
    ],
  },

  // AAC is the NI Stems standard (default if omitted)
  codec: 'aac',
});
```

## Command Line Interface

```bash
# Inspect file structure
npx m4a-stems song.stem.m4a

# Show only metadata
npx m4a-stems song.stem.m4a --metadata

# Show only lyrics
npx m4a-stems song.stem.m4a --lyrics

# Show MP4 atom tree
npx m4a-stems song.stem.m4a --atoms
```

## API Reference

### Extractor (FFmpeg-free)

```javascript
import * as Extractor from 'm4a-stems/extractor';
```

All functions are synchronous. Input accepts `Uint8Array`, `ArrayBuffer`, or Node.js `Buffer`:

```javascript
Extractor.extractTrack(data, trackIndex) → Uint8Array
Extractor.extractAllTracks(data) → Uint8Array[]
Extractor.getTrackCount(data) → number
Extractor.getTrackInfo(data) → TrackInfo[]
```

### Atoms

```javascript
import { Atoms } from 'm4a-stems';

// NI Stems metadata
await Atoms.readNiStemsMetadata(filePath) → Object
await Atoms.addNiStemsMetadata(filePath, stemNames) → void

// Karaoke data
await Atoms.readKaraAtom(filePath) → Object
await Atoms.writeKaraAtom(filePath, karaData) → void

// Standard metadata
await Atoms.addStandardMetadata(filePath, metadata) → void
await Atoms.addMusicalKey(filePath, key) → void

// Advanced features
await Atoms.writeVpchAtom(filePath, pitchData) → void  // Vocal pitch
await Atoms.writeKonsAtom(filePath, onsetsArray) → void // Beat onsets
await Atoms.dumpAtomTree(filePath) → Object[]
```

### Reader

```javascript
import { M4AStemsReader } from 'm4a-stems';

const data = await M4AStemsReader.load(filePath);
// {
//   metadata: { title, artist, album, duration, key, tempo, genre, year },
//   lyrics: [{ start, end, text, words? }],
//   features: { vocalPitch, onsets },
//   audio: { sources, timing, profile }
// }
```

### Writer (Requires FFmpeg)

```javascript
import { M4AStemsWriter } from 'm4a-stems';

await M4AStemsWriter.write({
  outputPath,
  stemsWavFiles: { vocals, drums, bass, other },  // WAV files to encode
  mixdownWav,
  metadata: { title, artist, album, key, tempo, genre, year },
  lyricsData: { lines },
  codec: 'aac',  // 'aac' (default, NI Stems standard) or 'alac' (lossless)
});
```

## Format Compatibility

**DJ Software (Full Stem Support):**
- Native Instruments Traktor
- Mixxx

**Audio Players (Master Track Only):**
- Any M4A/AAC compatible player

**Karaoke Applications:**
- [Loukai](https://github.com/monteslu/loukai) - Full karaoke player with stem control

## Testing

```bash
npm test           # Run tests
npm run test:coverage  # With coverage
npm run lint       # Linting
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Created by [Luis Montes](https://github.com/monteslu) as part of the [Loukai](https://github.com/monteslu/loukai) karaoke project.

See the [Loukai M4A Format Specification](https://github.com/monteslu/loukai/blob/main/docs/m4a_format.md) for complete format details.
