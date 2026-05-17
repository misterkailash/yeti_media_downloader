// ESM wrapper around lib/ua.js. Same pattern as utils/http.js — Nitro
// endpoints import ESM, server.js requires CJS, both see the same strings.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/ua.js');

export const UA_DESKTOP_120 = lib.UA_DESKTOP_120;
export const UA_DESKTOP_120_LITE = lib.UA_DESKTOP_120_LITE;
export const UA_DESKTOP_121 = lib.UA_DESKTOP_121;
export const UA_DESKTOP_124 = lib.UA_DESKTOP_124;
export const UA_DESKTOP_124_LITE = lib.UA_DESKTOP_124_LITE;
export const UA_MOBILE_IPHONE = lib.UA_MOBILE_IPHONE;
export const UA_INSTAGRAM_ANDROID = lib.UA_INSTAGRAM_ANDROID;
