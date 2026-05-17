// ESM wrapper around lib/util.js (shared small helpers). server.js (CJS)
// requires lib/util.js directly; Nitro endpoints import from here.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/util.js');

export const decodeHtmlEntities = lib.decodeHtmlEntities;
export const formatCount = lib.formatCount;
export const parseOgDescription = lib.parseOgDescription;
export const contentDispoAttachment = lib.contentDispoAttachment;
