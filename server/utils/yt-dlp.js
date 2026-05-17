// ESM wrapper around lib/yt-dlp.js. See utils/session.js for the pattern.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/yt-dlp.js');

export const ytExec = lib.ytExec;
export const ytdlpPath = lib.ytdlpPath;
export const ffmpegPath = lib.ffmpegPath;
