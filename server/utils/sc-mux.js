// ESM wrapper for lib/sc-mux.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/sc-mux.js');

export const normalizeScUrl = lib.normalizeScUrl;
export const getScEntry = lib.getScEntry;
export const abortScEntry = lib.abortScEntry;
