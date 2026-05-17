// ESM wrapper for lib/tt.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/tt.js');

export const fetchSsstik = lib.fetchSsstik;
export const fetchTikdownloader = lib.fetchTikdownloader;
export const fetchTtMobileApi = lib.fetchTtMobileApi;
export const fetchTikwm = lib.fetchTikwm;
export const resolveTtVideoUrl = lib.resolveTtVideoUrl;
