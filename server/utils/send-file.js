// ESM wrapper for lib/send-file.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/send-file.js');

export const sendFile = lib.sendFile;
