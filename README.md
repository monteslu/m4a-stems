# m4a-stems

[![Tests](https://github.com/monteslu/m4a-stems/actions/workflows/test.yml/badge.svg)](https://github.com/monteslu/m4a-stems/actions/workflows/test.yml)
[![npm version](https://badge.fury.io/js/m4a-stems.svg)](https://www.npmjs.com/package/m4a-stems)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Read and write multi-track M4A Stems files with karaoke extensions.

**Perfect for karaoke applications** - Store backing tracks and synchronized lyrics in a single file format compatible with DJ software like Traktor and Mixxx.

## Features

- 🎵 **Multi-track Audio** - Read/write M4A files with separate stems (vocals, drums, bass, etc.)
- 🎤 **Karaoke Lyrics** - Synchronized lyrics with word-level timing
- 🎹 **Musical Metadata** - Key detection, BPM, vocal pitch tracking, onset detection
- 🔧 **File Integrity** - Safe read/write operations that preserve audio quality
- 📝 **iTunes Compatible** - Standard metadata atoms (title, artist, album, cover art)
- 🎛️ **DJ Software Ready** - Compatible with NI Traktor, Mixxx, and other stems-compatible software

## Installation

```bash
npm install m4a-stems
```

**Requirements:**
- Node.js >= 18.0.0
- FFmpeg (for audio track extraction and encoding)

## Quick Start

### Reading M4A Stems Files

```javascript
import { M4AStemsReader } from 'm4a-stems';

const data = await M4AStemsReader.load('song.stem.m4a');

// Access metadata
console.log(data.metadata.title);    // "Song Title"
console.log(data.metadata.artist);   // "Artist Name"
console.log(data.metadata.key);      // "Am" (musical key)
console.log(data.metadata.tempo);    // 120 (BPM)

// Access stems
console.log(data.audio.sources);
// [
//   { name: 'vocals', trackIndex: 0, gain: 0, pan: 0 },
//   { name: 'drums', trackIndex: 1, gain: 0, pan: 0 },
//   { name: 'bass', trackIndex: 2, gain: 0, pan: 0 },
//   { name: 'other', trackIndex: 3, gain: 0, pan: 0 }
// ]

// Access lyrics with timing
console.log(data.lyrics);
// [
//   { start: 0.5, end: 2.0, text: 'First line of lyrics' },
//   { start: 2.5, end: 4.0, text: 'Second line of lyrics' }
// ]

// Access karaoke features (if available)
if (data.features.vocalPitch) {
  console.log('Vocal pitch data:', data.features.vocalPitch.sampleRate);
}
if (data.features.onsets) {
  console.log('Beat onsets:', data.features.onsets);
}
```

### Writing M4A Stems Files

```javascript
import { M4AStemsWriter } from 'm4a-stems';

await M4AStemsWriter.write({
  outputPath: 'output.stem.m4a',

  // Audio stems (separate tracks)
  stemsWavFiles: {
    vocals: 'tracks/vocals.wav',
    drums: 'tracks/drums.wav',
    bass: 'tracks/bass.wav',
    other: 'tracks/other.wav',
  },

  // Mixdown (full mix for preview)
  mixdownWav: 'tracks/mixdown.wav',

  // Metadata
  metadata: {
    title: 'Song Title',
    artist: 'Artist Name',
    album: 'Album Name',
    year: 2024,
    genre: 'Rock',
    key: 'Am',        // Musical key
    tempo: 120,       // BPM
  },

  // Karaoke lyrics
  lyricsData: {
    lines: [
      { start: 0.5, end: 2.0, text: 'First line of lyrics' },
      { start: 2.5, end: 4.0, text: 'Second line of lyrics' },
    ],
  },

  // Stems profile
  profile: 'STEMS-4',  // 'STEMS-4' or 'STEMS-2'

  // Audio codec
  codec: 'aac',        // 'aac' or 'alac' (lossless)

  // Optional: Cover art
  coverArt: 'cover.jpg',
});
```

## Command Line Interface (CLI)

The library includes a CLI tool for inspecting M4A Stems files:

```bash
# Inspect a file (shows all data)
npx m4a-stems song.stem.m4a

# Show only metadata
npx m4a-stems song.stem.m4a --metadata

# Show only lyrics
npx m4a-stems song.stem.m4a --lyrics

# Show only audio sources
npx m4a-stems song.stem.m4a --audio

# Show only features (pitch, onsets)
npx m4a-stems song.stem.m4a --features

# Show raw MP4 atom tree structure
npx m4a-stems song.stem.m4a --atoms

# Compact JSON output (no pretty print)
npx m4a-stems song.stem.m4a --compact

# Show raw music-metadata output
npx m4a-stems song.stem.m4a --raw

# Save to file
npx m4a-stems song.stem.m4a > output.json
```

**CLI Options:**
- `--help, -h` - Show help message
- `--metadata, -m` - Show only metadata
- `--lyrics, -l` - Show only lyrics
- `--audio, -a` - Show only audio sources
- `--features, -f` - Show only features (pitch, onsets)
- `--atoms` - Show raw MP4 atom tree structure
- `--raw` - Show raw parsed data from music-metadata
- `--compact` - Compact JSON output (no pretty print)

**Example Output:**
```bash
$ npx m4a-stems song.stem.m4a --metadata
{
  "metadata": {
    "title": "Song Title",
    "artist": "Artist Name",
    "album": "Album Name",
    "duration": 180.5,
    "key": "Am",
    "tempo": 120,
    "genre": "Rock",
    "year": 2024
  }
}
```

## Advanced Usage

### Adding/Updating Metadata

```javascript
import { addStandardMetadata, addMusicalKey } from 'm4a-stems';

// Update standard metadata
await addStandardMetadata('song.stem.m4a', {
  title: 'New Title',
  artist: 'New Artist',
  album: 'New Album',
  year: 2024,
  genre: 'Pop',
  tempo: 128,
});

// Add musical key for harmonic mixing
await addMusicalKey('song.stem.m4a', 'C#m');
```

### Writing Karaoke Data

```javascript
import { writeKaraAtom } from 'm4a-stems';

await writeKaraAtom('song.stem.m4a', {
  audio: {
    sources: [
      { id: 'vocals', role: 'vocals', track: 0 },
      { id: 'drums', role: 'drums', track: 1 },
      { id: 'bass', role: 'bass', track: 2 },
      { id: 'other', role: 'other', track: 3 },
    ],
    profile: 'STEMS-4',
    encoder_delay_samples: 0,
  },
  timing: {
    offset_sec: 0,
  },
  lines: [
    { start: 0.5, end: 2.0, text: 'Hello world' },
    { start: 2.5, end: 4.0, text: 'This is karaoke' },
  ],
});
```

### Adding Vocal Pitch Data

```javascript
import { writeVpchAtom } from 'm4a-stems';

// For pitch visualization and auto-tune
await writeVpchAtom('song.stem.m4a', {
  sampleRate: 25,  // Hz
  data: [
    { midi: 60, cents: 0 },    // C4
    { midi: 62, cents: 10 },   // D4 +10 cents
    { midi: 64, cents: -5 },   // E4 -5 cents
  ],
});
```

### Adding Onset Detection Data

```javascript
import { writeKonsAtom } from 'm4a-stems';

// Beat onsets for rhythm game sync
await writeKonsAtom('song.stem.m4a', [
  0.5,  // First beat at 0.5 seconds
  1.2,  // Second beat at 1.2 seconds
  2.3,  // Third beat at 2.3 seconds
]);
```

## File Format

This library implements the [M4A Karaoke Format Specification](https://github.com/monteslu/m4a-karaoke-spec), which extends the standard M4A container format with:

- **`kara` atom** - Karaoke lyrics with timing and stem routing
- **`vpch` atom** - Vocal pitch tracking data (MIDI notes + cents)
- **`kons` atom** - Karaoke onset detection (beat markers)
- **Standard iTunes atoms** - Compatible with existing MP4 metadata

All karaoke-specific atoms are stored in the standard iTunes metadata location (`moov.udta.meta.ilst`) using the freeform atom format, ensuring compatibility with existing MP4 parsers.

## API Reference

### Reader

#### `M4AStemsReader.load(filePath)`

Load and parse an M4A Stems file.

**Returns:** Object with structure:
```javascript
{
  metadata: {
    title: string,
    artist: string,
    album: string,
    duration: number,    // seconds
    key: string,         // musical key (e.g., "Am")
    tempo: number,       // BPM
    genre: string,
    year: number,
  },
  audio: {
    sources: [
      { name: string, trackIndex: number, gain: number, pan: number }
    ],
    profile: string,     // 'STEMS-4' or 'STEMS-2'
    timing: {
      offsetSec: number,
      encoderDelaySamples: number,
    },
  },
  lyrics: [
    { start: number, end: number, text: string }
  ],
  features: {
    vocalPitch: { sampleRate: number, data: [...] },
    onsets: [number, ...],  // onset times in seconds
  },
}
```

### Writer

#### `M4AStemsWriter.write(options)`

Create an M4A Stems file from separate audio tracks.

**Options:**
- `outputPath` (string) - Output file path
- `stemsWavFiles` (object) - Map of stem names to WAV file paths
- `mixdownWav` (string) - Path to mixdown WAV file
- `metadata` (object) - Song metadata (title, artist, album, etc.)
- `lyricsData` (object) - Karaoke lyrics with timing
- `profile` (string) - 'STEMS-4' or 'STEMS-2'
- `codec` (string) - 'aac' or 'alac'
- `coverArt` (string, optional) - Path to cover image

### Metadata Functions

#### `addStandardMetadata(filePath, metadata)`

Add or update iTunes metadata atoms.

#### `addMusicalKey(filePath, key)`

Add musical key for harmonic mixing (e.g., "Am", "C#m", "5A").

#### `writeKaraAtom(filePath, karaData)`

Write karaoke data atom with lyrics and stem routing.

#### `writeVpchAtom(filePath, pitchData)`

Write vocal pitch tracking data.

#### `writeKonsAtom(filePath, onsetsArray)`

Write onset detection timestamps.

## Testing

This library includes comprehensive integrity tests to prevent file corruption:

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linter
npm run lint
```

## File Integrity Guarantees

All write operations are tested to ensure:
- ✅ Audio streams remain unchanged when editing metadata
- ✅ Metadata updates don't create duplicate atoms
- ✅ Multiple sequential writes don't corrupt files
- ✅ Unknown atoms are preserved for forward compatibility
- ✅ Chunk offset tables are correctly updated

See [test/integrity.test.js](test/integrity.test.js) for the full test suite.

## Format Compatibility

**Works with:**
- Native Instruments Traktor DJ Software
- Mixxx DJ Software
- Any software supporting M4A Stems format
- Standard MP4/M4A players (plays mixdown track)

**Karaoke extensions supported by:**
- [Loukai Karaoke Player](https://github.com/monteslu/kai-player)
- [Kai Converter](https://github.com/monteslu/kai-converter)

## Ecosystem

This library is part of the Loukai karaoke ecosystem:

- **[kai-player](https://github.com/monteslu/kai-player)** - Desktop karaoke player
- **[kai-converter](https://github.com/monteslu/kai-converter)** - Convert CDG, ZIP+MP3, and other formats
- **[m4a-stems](https://github.com/monteslu/m4a-stems)** - This library

## Contributing

Contributions welcome! Please ensure:
- All tests pass (`npm test`)
- Linting passes (`npm run lint`)
- Test coverage remains high (`npm run test:coverage`)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Created by [Luis Montes](https://github.com/monteslu) as part of the Loukai karaoke project.

Format specification: [M4A Karaoke Format](https://github.com/monteslu/m4a-karaoke-spec)
