<script setup>
// SoundCloud view: paste a track URL, server downloads via yt-dlp and
// transcodes to 320 kbps CBR MP3 via the bundled ffmpeg. The shared
// VideoResult component renders the album-art square layout (kind=audio),
// title, artist, and the "Preparing X%" indicator while the transcode
// runs.
import VideoResult from '../components/VideoResult.vue';
</script>

<template>
  <VideoResult />
</template>
