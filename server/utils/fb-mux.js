// ESM wrapper for lib/fb-mux.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/fb-mux.js');

export const normalizeFbVideoUrl = lib.normalizeFbVideoUrl;
export const resolveFbShareUrl = lib.resolveFbShareUrl;
export const fbCommonArgs = lib.fbCommonArgs;
export const getFbEntry = lib.getFbEntry;
export const abortFbEntry = lib.abortFbEntry;
