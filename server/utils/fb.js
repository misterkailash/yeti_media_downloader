// ESM wrapper around lib/fb.js. See utils/session.js for the pattern.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/fb.js');

export const isUsableImageUrl = lib.isUsableImageUrl;
export const upgradeFbScontentUrl = lib.upgradeFbScontentUrl;
export const pickLargestFbPicUrl = lib.pickLargestFbPicUrl;
export const fbBrowserHeaders = lib.fbBrowserHeaders;
export const parseFbDescription = lib.parseFbDescription;
