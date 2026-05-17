// yt-dlp wrapper. Shared between the IG, YouTube, Facebook video, Reddit,
// and SoundCloud paths — they all run the same binary with different args
// to extract media info or mux best video+audio. The wrapper exposes:
//   - ytdlpPath  : absolute path to the bundled binary (npm dep)
//   - ffmpegPath : absolute path to the bundled ffmpeg (npm dep)
//   - ytExec(args, timeoutMs) : Promise<{stdout, stderr}> — resolves on
//     exit 0, rejects with err.stderr populated on non-zero exit or timeout.
//
// We invoke yt-dlp via raw spawn (not the youtube-dl-exec wrapper's API)
// because the wrapper uses shell:true and doesn't quote args, so paths
// containing spaces get word-split. spawn() without shell passes each arg
// verbatim.
const { spawn } = require('child_process');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');

const ytdlpPath = youtubedl.constants && youtubedl.constants.YOUTUBE_DL_PATH;

function ytExec(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      console.warn(`[yt-dlp] timed out after ${timeoutMs}ms — killing process`);
      proc.kill('SIGKILL');
    }, timeoutMs);
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const err = new Error(`yt-dlp exited ${code}`);
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = { ytExec, ytdlpPath, ffmpegPath };
