<script setup lang="ts">
import type { PartType } from "../../shared/types.ts";
defineProps<{ type: PartType }>();
const shapes: Record<PartType, string> = {
  pod: '<path d="m17 5-9 30h28L27 5Z" fill="#cedbd9"/><path d="M8 35h28v5H8Z" fill="#667f8a"/><path d="M17 18h10l2 8H15Z" fill="#233e51"/><path d="M19 7h6" stroke="#f4f5ed" stroke-width="2"/>',
  tank: '<rect x="11" y="4" width="24" height="43" rx="3" fill="#cdd6d1"/><path d="M11 7h24M11 44h24" stroke="#8fa39f" stroke-width="3"/><path d="M11 37h24" stroke="#e6956b" stroke-width="4"/><path d="M15 18h16M15 21h12" stroke="#758d93"/>',
  engine:
    '<path d="M9 9h29v6H9Z" fill="#a0b4b9"/><path d="M18 15h10l-2 11 10 19H10l10-19Z" fill="#788892"/><path d="M10 44h26" stroke="#b9beb0" stroke-width="2"/><path d="M14 17v10M32 17v10" stroke="#d5b38c" stroke-width="3"/>',
  decoupler:
    '<ellipse cx="23" cy="18" rx="17" ry="6" fill="#86999d"/><path d="M6 18v15q17 12 34 0V18q-17 12-34 0Z" fill="#ddb15b"/><path d="m10 23 5 15m6-12 5 15m6-17 5 13" stroke="#31464f" stroke-width="4"/><ellipse cx="23" cy="18" rx="11" ry="3" fill="#1c2a31"/>',
  fin: '<path d="M9 9 35 36v5H9Z" fill="#bdcdd0"/><path d="M9 9v32" stroke="#769097" stroke-width="4"/><path d="M31 36h4v5h-4Z" fill="#e59b78"/>',
  rcs: '<path d="M14 17h18v19H14Z" fill="#cfdbd8"/><path d="M18 10h10v8H18ZM18 35h10v8H18ZM31 22h9v10h-9ZM5 22h10v10H5Z" fill="#72868e"/><path d="M20 23h7v7h-7Z" fill="#e3ae7c"/>',
  battery:
    '<ellipse cx="23" cy="17" rx="15" ry="5" fill="#97afb3"/><path d="M8 17v18q15 10 30 0V17q-15 10-30 0Z" fill="#536a76"/><path d="m25 21-7 8h5l-2 8 8-10h-6Z" fill="#e4b680"/>',
  solar:
    '<path d="M4 21h8v5H4Z" fill="#a0acb2"/><path d="M10 10h31v31H10Z" fill="#97aeb5"/><path d="M12 12h27v27H12Z" fill="#2f6b8b"/><path d="M21 12v27M30 12v27M12 21h27M12 30h27" stroke="#80a9b4" stroke-width="1"/>',
};
</script>
<template>
  <svg viewBox="0 0 46 52" aria-hidden="true" v-html="shapes[type]" />
</template>
