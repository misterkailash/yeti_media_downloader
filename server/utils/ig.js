// ESM wrapper around lib/ig.js. See utils/session.js for the pattern.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/ig.js');

export const IG_APP_ID = lib.IG_APP_ID;
export const IG_WEB_APP_ID = lib.IG_WEB_APP_ID;
export const parseIgChallenge = lib.parseIgChallenge;
export const invalidateIgSession = lib.invalidateIgSession;
export const resolveUserId = lib.resolveUserId;
export const igVideoVersions = lib.igVideoVersions;
export const igAuthedHeaders = lib.igAuthedHeaders;
export const checkIsPrivateWeb = lib.checkIsPrivateWeb;
export const fetchIgWebProfileInfo = lib.fetchIgWebProfileInfo;
export const fetchIgPolarisProfile = lib.fetchIgPolarisProfile;
export const fetchIgPostsAuthed = lib.fetchIgPostsAuthed;
export const parseIgPostsFromHtml = lib.parseIgPostsFromHtml;
export const writeIgCookieFile = lib.writeIgCookieFile;
export const igFormatsFromYtDlp = lib.igFormatsFromYtDlp;
export const extractIgShortcode = lib.extractIgShortcode;
export const extractIgUsernameFromUrl = lib.extractIgUsernameFromUrl;
export const igShortcodeToMediaId = lib.igShortcodeToMediaId;
export const bestImageFromIgItem = lib.bestImageFromIgItem;
export const buildIgSlide = lib.buildIgSlide;
export const fetchIgMediaSlides = lib.fetchIgMediaSlides;
export const fetchIgMediaImageUrl = lib.fetchIgMediaImageUrl;
export const fetchIgMediaInfo = lib.fetchIgMediaInfo;
