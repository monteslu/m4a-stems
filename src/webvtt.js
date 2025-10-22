/**
 * WebVTT Generator
 * Convert karaoke lyrics to WebVTT format
 */

/**
 * Generate WebVTT from lyrics data
 * @param {Object} lyricsData - Lyrics data with lines and singers
 * @param {number} encoderDelaySamples - Encoder delay to compensate (e.g., 1105 for AAC)
 * @param {number} sampleRate - Audio sample rate
 * @returns {string} WebVTT formatted string
 */
export function generateWebVTT(lyricsData, encoderDelaySamples = 0, sampleRate = 44100) {
  const lines = lyricsData.lines || [];
  const singers = {};

  // Build singers lookup
  for (const singer of lyricsData.singers || []) {
    singers[singer.id] = singer;
  }

  // Calculate time offset from encoder delay
  const delayOffset = encoderDelaySamples / sampleRate;

  // Start WebVTT file
  const vttLines = ['WEBVTT', ''];

  for (const lineData of lines) {
    // Skip disabled lines
    if (lineData.disabled) {
      continue;
    }

    // Get line timing (adjust for encoder delay)
    const startTime = lineData.start + delayOffset;
    const endTime = lineData.end + delayOffset;

    // Format timestamps
    const startTs = formatTimestamp(startTime);
    const endTs = formatTimestamp(endTime);

    // Build cue text with voice tags and word timing
    const cueText = buildCueText(lineData, singers);

    // Add cue
    vttLines.push(`${startTs} --> ${endTs}`);
    vttLines.push(cueText);
    vttLines.push(''); // Blank line between cues
  }

  return vttLines.join('\n');
}

/**
 * Format timestamp for WebVTT (HH:MM:SS.mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = secs.toFixed(3).padStart(6, '0');

  return `${hh}:${mm}:${ss}`;
}

/**
 * Build cue text with voice tags and word-level timing
 * @param {Object} lineData - Line data from karaoke format
 * @param {Object} singers - Dictionary of singer info
 * @returns {string} Formatted cue text
 */
function buildCueText(lineData, singers) {
  let text = lineData.text;
  const singerId = lineData.singer || 'A';
  const backup = lineData.backup || false;
  const wordTiming = lineData.word_timing || [];

  // Start with voice tag if singer specified
  const cueParts = [];
  if (singerId && singers[singerId]) {
    cueParts.push(`<v ${singerId}>`);
  }

  // Add class tag for backup vocals
  if (backup) {
    cueParts.push('<c.backup>');
  }

  // Add word-level timing if available
  if (wordTiming && wordTiming.length > 0) {
    // Split text into words
    const words = text.split(/\s+/);

    if (words.length === wordTiming.length) {
      // Build text with karaoke timestamps
      const wordParts = [];
      const lineStart = lineData.start;

      for (let i = 0; i < words.length; i++) {
        const [wordStartRel] = wordTiming[i];
        // Convert relative time to absolute
        const wordStartAbs = lineStart + wordStartRel;

        // Add timestamp before word (karaoke-style)
        const timestamp = formatTimestamp(wordStartAbs);
        wordParts.push(`<${timestamp}>${words[i]}`);
      }

      text = wordParts.join(' ');
    } else {
      // Mismatch between words and timing - just use plain text
      console.warn(
        `Word count mismatch: ${words.length} words, ${wordTiming.length} timings`
      );
    }
  }

  cueParts.push(text);

  // Close backup class tag
  if (backup) {
    cueParts.push('</c>');
  }

  return cueParts.join('');
}

/**
 * Validate WebVTT content
 * @param {string} vttContent - WebVTT string to validate
 * @returns {boolean} True if valid
 */
export function validateWebVTT(vttContent) {
  const lines = vttContent.split('\n');

  // Must start with WEBVTT
  if (!lines || lines.length === 0 || lines[0].trim() !== 'WEBVTT') {
    console.error("WebVTT must start with 'WEBVTT'");
    return false;
  }

  // Check for at least one cue
  const hasCue = lines.some((line) => line.includes('-->'));
  if (!hasCue) {
    console.warn('WebVTT has no cues');
    return false;
  }

  return true;
}
