# API Documentation

## M4AStemsReader

### `load(m4aPath)`

Load and parse an M4A Stems file.

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
    key: string,      // Musical key (e.g., "C major")
    tempo: number,
    genre: string,
    year: number | null
  },
  audio: {
    sources: Array<{
      name: string,
      filename: string,
      gain: number,
      pan: number,
      solo: boolean,
      mute: boolean,
      trackIndex: number,
      audioData: Buffer | null
    }>,
    presets: Array<Object>,
    timing: {
      offsetSec: number,
      encoderDelaySamples: number
    },
    profile: string  // "STEMS-2" or "STEMS-4"
  },
  lyrics: Array<{
    start: number,
    end: number,
    text: string
  }> | null,
  features: {
    vocalPitch: Object | null,
    onsets: Array<number> | null
  }
}
```

### `extractTrack(m4aPath, trackIndex)`

Extract a single audio track from M4A file.

**Parameters:**
- `m4aPath` (string): Path to M4A file
- `trackIndex` (number): Track index (0-based)

**Returns:** Promise<Buffer>

### `extractAllTracks(m4aPath, sources)`

Extract all audio tracks from M4A file.

**Parameters:**
- `m4aPath` (string): Path to M4A file
- `sources` (Array): Array of source definitions

**Returns:** Promise<Map<string, Buffer>>

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
    - `other`: string (for STEMS-4)
    - `music`: string (for STEMS-2)
  - `mixdownWav` (string): Path to mixdown WAV file
  - `metadata` (Object):
    - `title`: string
    - `artist`: string
    - `album`: string (optional)
    - `key`: string (optional, e.g., "C major")
    - `tempo`: number (optional)
    - `genre`: string (optional)
    - `year`: number (optional)
  - `lyricsData` (Object):
    - `lines`: Array<{start: number, end: number, text: string}>
    - `singers`: Array (optional)
  - `analysisFeatures` (Object, optional):
    - `vocal_pitch`: Object
    - `onsets`: Array<number>
    - `key_detection`: Object
  - `profile` (string): "STEMS-2" or "STEMS-4" (default: "STEMS-4")
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
  profile: string,
  codec: string,
  encoderDelaySamples: number
}
```

## Atoms

### `writeKaidAtom(filePath, kaidData)`

Write karaoke data atom.

### `writeVpchAtom(filePath, pitchData)`

Write vocal pitch atom.

### `writeKonsAtom(filePath, onsetsData)`

Write onsets atom.

### `addNiStemsMetadata(filePath, stemNames)`

Add NI Stems metadata.

### `disableTracks(filePath, trackIndices)`

Disable specific tracks.

### `getKaraokeFeatures(filePath)`

Get karaoke features from file.

## Examples

See [README.md](../README.md) for usage examples.
