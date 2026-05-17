// ESM wrapper around lib/http.js so Nitro endpoints can pull in the shared
// HTTP helpers cleanly. server.js (CJS) still requires lib/http.js
// directly — both sides see the same exports. When server.js is gone,
// inline the bodies here and delete lib/http.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/http.js');

export const httpsGet = lib.httpsGet;
export const httpsPost = lib.httpsPost;
export const httpHead = lib.httpHead;
