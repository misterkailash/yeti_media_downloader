<script setup>
// X / Twitter view: tweet URL → either video (mp4) or photo download.
// The same VideoResult component handles both kinds — kind is set to
// either 'video' or 'image' in the search store based on data.mediaType
// from the /api/x-tweet response.
</script>

<template>
  <VideoResult />
</template>
