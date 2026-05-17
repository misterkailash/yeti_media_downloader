// ESM wrapper for lib/yt-mux.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/yt-mux.js');

export const normalizeYtUrl = lib.normalizeYtUrl;
export const YT_BASE_ARGS = lib.YT_BASE_ARGS;
export const getMuxEntry = lib.getMuxEntry;
export const abortMuxEntry = lib.abortMuxEntry;
