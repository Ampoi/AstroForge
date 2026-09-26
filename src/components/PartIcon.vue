<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { PartType } from '../../shared/types.ts';
import { partThumbnails } from '../part-thumbnails.ts';
const props=defineProps<{type: PartType}>();
const source=ref<string>();
function update(){source.value=partThumbnails().get(props.type);}
onMounted(update);
watch(()=>props.type,update);
</script>
<template>
  <img v-if="source" :src="source" alt="" aria-hidden="true" draggable="false" />
  <span v-else aria-hidden="true">◇</span>
</template>
<style scoped>
img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
</style>
