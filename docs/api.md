# API Documentation

## Extractor (FFmpeg-free)

Extract individual audio tracks from multi-track M4A files without requiring FFmpeg.

### `extractTrack(filePath, trackIndex)`

Extract a single track as a playable M4A buffer.

**Parameters:**
- `filePath` (string): Path to M4A file
- `trackIndex` (number): Track index (0-based)

**Returns:** Promise<Buffer> - Playable M4A file buffer

```javascript
import { Extractor } from 'm4a-stems';

const masterBuffer = await Extractor.extractTrack('song.stem.m4a', 0);  // Master
const vocalsBuffer = await Extractor.extractTrack('song.stem.m4a', 4);  // Vocals
```

### `extractAllTracks(filePath)`

Extract all audio tracks from an M4A file.

**Parameters:**
- `filePath` (string): Path to M4A file

**Returns:** Promise<Array<Buffer>> - Array of playable M4A file buffers

```javascript
const tracks = await Extractor.extractAllTracks('song.stem.m4a');
// tracks[0] = master, tracks[1] = drums, etc.
```

### `getTrackCount(filePath)`

Get the number of tracks in an M4A file.

**Parameters:**
- `filePath` (string): Path to M4A file

**Returns:** Promise<number>

### `getTrackInfo(filePath)`

Get information about all tracks in an M4A file.

**Parameters:**
- `filePath` (string): Path to M4A file

**Returns:** Promise<Array<Object>>
```javascript
[
  { index: 0, sampleCount: 6789, duration: 157.62, timescale: 44100 },
  { index: 1, sampleCount: 6789, duration: 157.62, timescale: 44100 },
  // ...
]
```

## M4AStemsReader

### `load(m4aPath)`

Load and parse an M4A Stems file with karaoke extensions.

**Parameters:**
- `m4aPath` (string): Path to .stem.m4a file

**Returns:** Promise<Object>
```javascript
{
  metadata: {
    title: string,
    artist: string,
    album: string,
    duration: number,
    key: string,      // Musical key (e.g., "Am")
    tempo: number,
    genre: string,
    year: number | null
  },
  lyrics: Array<{
    start: number,
    end: number,
    text: string,
    words?: { timings: Array<[number, number]> }
  }> | null,
  features: {
    vocalPitch: Object | null,
    onsets: Array<number> | null
  },
  // Only present if kara atom exists:
  audio?: {
    sources: Array<Object>,
    presets: Array<Object>,
    timing: { offsetSec: number, encoderDelaySamples: number },
    profile: string  // "STEMS-2" or "STEMS-4"
  },
  singers?: Array<Object>
}
```

### `extractTrack(m4aPath, trackIndex)` (FFmpeg required)

Extract a single audio track using FFmpeg.

**Parameters:**
- `m4aPath` (string): Path to M4A file
- `trackIndex` (number): Track index (0-based)

**Returns:** Promise<Buffer>

> Note: For FFmpeg-free extraction, use `Extractor.extractTrack()` instead.

### `extractAllTracks(m4aPath, sources)` (FFmpeg required)

Extract all audio tracks using FFmpeg.

**Parameters:**
- `m4aPath` (string): Path to M4A file
- `sources` (Array): Array of source definitions with `track` and `role` properties

**Returns:** Promise<Map<string, Buffer>> - Map of track name to audio buffer

> Note: For FFmpeg-free extraction, use `Extractor.extractAllTracks()` instead.

## M4AStemsWriter

### `write(options)`

Create an M4A Stems file.

**Parameters:**
- `options` (Object):
  - `outputPath` (string): Output file path
  - `stemsWavFiles` (Object): Map of stem name to WAV file path
    - `vocals`: string
    - `drums`: string
    - `bass`: string
    - `other`: string
  - `mixdownWav` (string): Path to mixdown WAV file
  - `metadata` (Object):
    - `title`: string
    - `artist`: string
    - `album`: string (optional)
    - `key`: string (optional, e.g., "Am")
    - `tempo`: number (optional)
    - `genre`: string (optional)
    - `year`: number (optional)
  - `lyricsData` (Object):
    - `lines`: Array<{start: number, end: number, text: string, words?: Object}>
    - `singers`: Array (optional)
  - `analysisFeatures` (Object, optional):
    - `vocal_pitch`: Object
    - `onsets`: Array<number>
    - `key_detection`: Object
  - `codec` (string): "aac" or "alac" (default: "aac")
  - `bitrate` (string): AAC bitrate (default: auto-detect, max 256k)
  - `sampleRate` (number): Sample rate in Hz (default: 44100)
  - `coverArt` (string, optional): Path to cover art image

**Returns:** Promise<Object>
```javascript
{
  success: boolean,
  outputFile: string,
  fileSizeBytes: number,
  fileSha256: string,
  processingTimeSeconds: number,
  codec: string,
  encoderDelaySamples: number
}
```

## Atoms

Low-level atom manipulation functions.

### `readNiStemsMetadata(filePath)`

Read NI Stems metadata from the `stem` atom.

**Returns:** Promise<Object>
```javascript
{
  version: 1,
  mastering_dsp: { ... },
  stems: [
    { name: 'drums', color: '#FF0000' },
    { name: 'bass', color: '#00FF00' },
    { name: 'other', color: '#0000FF' },
    { name: 'vocals', color: '#FFFF00' }
  ]
}
```

### `addNiStemsMetadata(filePath, stemNames)`

Add NI Stems metadata for DJ software compatibility.

**Parameters:**
- `filePath` (string): Path to M4A file
- `stemNames` (Array<string>): Names for stems 1-4 (e.g., ['drums', 'bass', 'other', 'vocals'])

### `readKaraAtom(filePath)`

Read karaoke data from the `kara` atom.

**Returns:** Promise<Object>
```javascript
{
  timing: { offset_sec: 0 },
  lines: [{ start: 0.5, end: 2.0, text: 'Hello world', words: { timings: [[0, 0.4], [0.5, 1.0]] } }],
  singers: { ... }
}
```

### `writeKaraAtom(filePath, karaData)`

Write karaoke data to the `kara` atom.

**Parameters:**
- `filePath` (string): Path to M4A file
- `karaData` (Object): Karaoke data object

### `addStandardMetadata(filePath, metadata)`

Add standard iTunes metadata (title, artist, album, etc.).

### `addMusicalKey(filePath, key)`

Add musical key metadata.

**Parameters:**
- `filePath` (string): Path to M4A file
- `key` (string): Musical key (e.g., "Am", "C major")

### `writeVpchAtom(filePath, pitchData)`

Write vocal pitch data.

### `writeKonsAtom(filePath, onsetsData)`

Write beat onsets data.

### `dumpAtomTree(filePath)`

Dump the MP4 atom tree structure for debugging.

**Returns:** Promise<Array<Object>>

## WebVTT

Utilities for working with WebVTT subtitle format.

### `toWebVTT(lyrics)`

Convert lyrics array to WebVTT format.

### `fromWebVTT(vttContent)`

Parse WebVTT content to lyrics array.

## Track Layout

Standard stem file track layout:

| Track | Content |
|-------|---------|
| 0 | Master (full mix) |
| 1 | Drums |
| 2 | Bass |
| 3 | Other (melody, instruments) |
| 4 | Vocals |

## Examples

See [README.md](../README.md) for usage examples.
