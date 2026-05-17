// ESM wrapper for lib/album-zip.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/album-zip.js');

export const fetchBinary = lib.fetchBinary;
export const buildZip = lib.buildZip;
