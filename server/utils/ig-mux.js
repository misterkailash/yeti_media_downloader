// ESM wrapper for lib/ig-mux.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/ig-mux.js');

export const getIgEntry = lib.getIgEntry;
export const abortIgEntry = lib.abortIgEntry;
