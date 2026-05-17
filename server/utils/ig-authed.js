// ESM wrapper for lib/ig-authed.js. See utils/session.js for the pattern.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/ig-authed.js');

export const fetchIsPrivateAuthed = lib.fetchIsPrivateAuthed;
export const fetchUserBasics = lib.fetchUserBasics;
export const fetchIsFollowing = lib.fetchIsFollowing;
export const fetchUserInfoAuthed = lib.fetchUserInfoAuthed;
export const fetchUserPicViaFeed = lib.fetchUserPicViaFeed;
export const fetchUserFullDetail = lib.fetchUserFullDetail;
