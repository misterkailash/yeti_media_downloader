<script setup>
// YouTube view: video info + quality picker (144p → 4K), with the
// "Preparing X%" indicator while the server muxes audio + video on
// demand. The shared VideoResult component handles the picker UI; the
// quality data comes from /api/yt-info.
</script>

<template>
  <VideoResult />
</template>
