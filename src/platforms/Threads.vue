<script setup>
// Threads view: profile picture + follower stats. Threads inherits IG's
// profile pic in most cases — the threads-profile API hands off to the
// IG authed user info path when a sessionid is present.
import ProfileResult from '../components/ProfileResult.vue';
</script>

<template>
  <ProfileResult />
</template>
