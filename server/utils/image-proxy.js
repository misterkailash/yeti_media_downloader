// ESM wrapper for lib/image-proxy.js.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/image-proxy.js');

export const handleImageProxy = lib.handleImageProxy;
export const detectImageType = lib.detectImageType;
