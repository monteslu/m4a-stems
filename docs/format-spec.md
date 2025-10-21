# M4A Stems Karaoke Format Specification

Version: 1.0
Status: Draft

## Overview

This document specifies the M4A Stems + Karaoke format, which extends the NI Stems format with karaoke-specific features.

## Container Format

- **Base Format**: MP4/M4A container
- **Compatibility**: NI Traktor, Mixxx, Serato, rekordbox
- **Audio Codec**: AAC or ALAC
- **Subtitle Format**: WebVTT (mov_text)

## Audio Track Structure

### STEMS-4 Profile
- Track 0: Mixdown (enabled by default)
- Track 1: Drums
- Track 2: Bass
- Track 3: Other
- Track 4: Vocals

### STEMS-2 Profile
- Track 0: Mixdown (enabled by default)
- Track 1: Music (instrumental)
- Track 2: Vocals

## Custom Atoms

### `kaid` - Karaoke Data Atom

Location: `moov.udta.meta.ilst.----:com.stems:kaid`

Contains JSON with:
```json
{
  "stems_karaoke_version": "1.0",
  "audio": {
    "profile": "STEMS-4",
    "encoder_delay_samples": 1105,
    "sources": [
      {"track": 0, "id": "mixdown", "role": "mixdown"},
      {"track": 1, "id": "drums", "role": "drums"},
      {"track": 2, "id": "bass", "role": "bass"},
      {"track": 3, "id": "other", "role": "other"},
      {"track": 4, "id": "vocals", "role": "vocals"}
    ],
    "presets": [
      {"id": "karaoke", "levels": {"vocals": -120}}
    ]
  },
  "timing": {
    "reference": "aligned_to_vocals",
    "offset_sec": 0.000
  },
  "lines": [
    {"start": 0.5, "end": 2.0, "text": "First line"},
    {"start": 2.5, "end": 4.0, "text": "Second line"}
  ],
  "singers": [
    {"id": "A", "name": "Lead", "guide_track": 4}
  ]
}
```

### `vpch` - Vocal Pitch Atom

Location: `moov.udta.meta.ilst.----:com.stems:vpch`

Binary format:
- Version (1 byte): 0x01
- Sample rate (4 bytes, big-endian): e.g., 25 Hz
- Data length (4 bytes, big-endian): number of samples
- Pitch data (2 bytes per sample, big-endian):
  - MIDI note (1 byte): 0-127
  - Cents offset (1 byte signed): -50 to +50

### `kons` - Karaoke Onsets Atom

Location: `moov.udta.meta.ilst.----:com.stems:kons`

Binary format:
- Version (1 byte): 0x01
- Data length (4 bytes, big-endian): number of onsets
- Onset times (4 bytes per onset, big-endian): milliseconds

## iTunes Metadata

Standard iTunes metadata fields:
- `©nam`: Title
- `©ART`: Artist
- `©alb`: Album
- `©day`: Year
- `©gen`: Genre
- `trkn`: Track number
- `covr`: Cover art (JPEG or PNG)

Custom freeform tags:
- `----:com.apple.iTunes:initialkey`: Musical key (e.g., "C major", "A minor")

## NI Stems Metadata

Location: `moov.udta.meta.ilst.----:com.native-instruments:stems`

JSON format (base64 encoded):
```json
{
  "stems": [
    {"name": "Drums", "color": "#FF0000"},
    {"name": "Bass", "color": "#00FF00"},
    {"name": "Other", "color": "#0000FF"},
    {"name": "Vocals", "color": "#FFFF00"}
  ],
  "version": "1.0.0"
}
```

## WebVTT Subtitle Track

Format: WebVTT cues converted to mov_text
- One cue per lyric line
- Timing aligned to audio with encoder delay compensation
- UTF-8 encoded text

## Encoder Delay

AAC encoder introduces ~1105 samples of delay (25ms at 44.1kHz).
All timing values in kaid atom and WebVTT are pre-compensated.

## Track Flags

- Track 0 (mixdown): Enabled, default
- Tracks 1-4: Disabled by default (for Traktor compatibility)
- DJ software can enable/disable stems during playback

## File Naming Convention

Recommended: `{Artist} - {Title}.stem.m4a`

## Compatibility Notes

- **Traktor Pro**: Full compatibility (stems + lyrics via WebVTT)
- **Mixxx**: Full compatibility (stems + lyrics)
- **Serato**: Stems only (no karaoke features)
- **rekordbox**: Stems only (no karaoke features)
- **Loukai Player**: Full karaoke features (stems, lyrics, pitch, coaching)
