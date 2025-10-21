# m4a-stems

Read and write multi-track M4A Stems files with karaoke extensions.

## Features

- ✅ Read M4A Stems files (compatible with NI Traktor, Mixxx, etc.)
- ✅ Write M4A Stems files with multi-track audio
- ✅ Support for karaoke-specific features (lyrics, timing, vocal pitch)
- ✅ Custom atom handling (kaid, vpch, kons)
- ✅ iTunes metadata support (title, artist, album, key, etc.)
- ✅ WebVTT subtitle track support

## Requirements

- Node.js >= 18.0.0
- FFmpeg (for audio track extraction and encoding)

## Installation

```bash
npm install m4a-stems
```

## Usage

### Reading M4A Stems Files

```javascript
import { M4AStemsReader } from 'm4a-stems';

const data = await M4AStemsReader.load('path/to/file.stem.m4a');

console.log(data.metadata.title);  // Song title
console.log(data.metadata.artist); // Artist name
console.log(data.metadata.key);    // Musical key (e.g., "C major")
console.log(data.audio.sources);   // Array of stems (vocals, drums, bass, etc.)
console.log(data.lyrics);          // Karaoke lyrics with timing
```

### Writing M4A Stems Files

```javascript
import { M4AStemsWriter } from 'm4a-stems';

await M4AStemsWriter.write({
  outputPath: 'output.stem.m4a',
  stemsWavFiles: {
    vocals: '/path/to/vocals.wav',
    drums: '/path/to/drums.wav',
    bass: '/path/to/bass.wav',
    other: '/path/to/other.wav',
  },
  mixdownWav: '/path/to/mixdown.wav',
  metadata: {
    title: 'Song Title',
    artist: 'Artist Name',
    album: 'Album Name',
    key: 'C major',
  },
  lyricsData: {
    lines: [
      { start: 0.5, end: 2.0, text: 'First line of lyrics' },
      { start: 2.5, end: 4.0, text: 'Second line of lyrics' },
    ],
  },
  profile: 'STEMS-4', // or 'STEMS-2'
  codec: 'aac',       // or 'alac'
});
```

## Format Specification

See [docs/format-spec.md](docs/format-spec.md) for detailed format documentation.

## API Documentation

See [docs/api.md](docs/api.md) for complete API reference.

## License

MIT

## Credits

Part of the [Loukai](https://github.com/monteslu/kai-player) karaoke ecosystem.
