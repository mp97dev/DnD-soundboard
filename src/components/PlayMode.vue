<script setup>
import { useBoardsStore } from '../stores/boards'
import SoundButton from './SoundButton.vue'

const boards = useBoardsStore()
</script>

<template>
  <div
    class="play-grid"
    :style="{
      gridTemplateRows: `repeat(${boards.current.rows}, 1fr)`,
      gridTemplateColumns: `repeat(${boards.current.cols}, 1fr)`
    }"
  >
    <SoundButton
      v-for="btn in boards.current.buttons"
      :key="btn.id"
      :button="btn"
      :interactive="true"
    />
  </div>
</template>

<style scoped>
.play-grid {
  display: grid;
  gap: 8px;
  padding: 12px;
  height: 100%;
}
</style>
