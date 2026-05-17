// ESM wrapper for lib/rd-mux.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/rd-mux.js');

export const normalizeRdUrl = lib.normalizeRdUrl;
export const resolveRedditShareUrl = lib.resolveRedditShareUrl;
export const getRdEntry = lib.getRdEntry;
export const abortRdEntry = lib.abortRdEntry;
