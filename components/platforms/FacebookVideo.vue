<script setup>
// Facebook Video view: paste a facebook.com / fb.watch URL, server uses
// yt-dlp + ffmpeg to mux best video + audio into a single mp4. Same
// prepare-status flow as YouTube/Reddit — VideoResult shows the
// "Preparing X%" indicator while the mux runs server-side.
//
// Login-gated videos (private groups, some pages) require an FB session
// cookie; the server reuses cookies set via the sidebar's "Log in with
// Facebook" flow and returns a 401 with a helpful message otherwise.
</script>

<template>
  <VideoResult />
</template>
