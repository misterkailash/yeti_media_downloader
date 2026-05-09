<script setup>
// Reddit view: paste a reddit.com / redd.it / v.redd.it URL, server
// downloads the DASH video + audio streams via yt-dlp and muxes them
// into a single mp4 via the bundled ffmpeg. Same prepare-status flow
// as YouTube — the shared VideoResult component handles the
// "Preparing X%" indicator while the mux runs.
//
// Image and gallery posts aren't supported yet (text-only / image-only
// posts will return 404 from /api/rd-info). Could be added later by
// scraping Reddit's JSON API directly.
import VideoResult from '../components/VideoResult.vue';
</script>

<template>
  <VideoResult />
</template>
