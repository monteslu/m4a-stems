/**
 * m4a-stems
 * Read and write multi-track M4A Stems files with karaoke extensions
 */

import M4AStemsReader from './reader.js';
import M4AStemsWriter from './writer.js';
import * as Atoms from './atoms.js';
import * as WebVTT from './webvtt.js';
import * as Extractor from './extractor.js';

export { M4AStemsReader, M4AStemsWriter, Atoms, WebVTT, Extractor };

export default {
  Reader: M4AStemsReader,
  Writer: M4AStemsWriter,
  Atoms,
  WebVTT,
  Extractor,
};
