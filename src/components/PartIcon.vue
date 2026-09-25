<script setup lang="ts">
import type { PartType } from "../../shared/types.ts";
defineProps<{ type: PartType }>();
const sensor='<rect x="10" y="12" width="27" height="28" rx="4" fill="#627a94"/><circle cx="24" cy="26" r="9" fill="#143040" stroke="#6ed9d0" stroke-width="3"/>';
const shapes: Record<PartType, string> = {
  docking:'<circle cx="23" cy="26" r="17" fill="#bac9ce"/><circle cx="23" cy="26" r="11" fill="#263f4b"/><path d="M7 23h7M32 23h7M20 10v7M20 35v7" stroke="#e5b569" stroke-width="4"/>',
  servo:'<rect x="7" y="10" width="31" height="31" rx="4" fill="#d9a651"/><circle cx="23" cy="25" r="10" fill="#334b55"/><path d="M23 25 37 10" stroke="#bac9ce" stroke-width="6"/>',
  linear:'<path d="M19 5h8v22h-8Z" fill="#b9c8ce"/><path d="M12 23h22v23H12Z" fill="#617b88"/><path d="M14 22h18M14 46h18M16 5h14" stroke="#e5b569" stroke-width="3"/>',
  lidar2d:sensor,lidar3d:sensor,camera:sensor,startracker:sensor,
  chassis: '<path d="M4 15h34v25H4Z" fill="#b8c1ac"/><path d="m4 15 7-7h31l-4 7ZM38 15l4-7v25l-4 7" fill="#71867c"/><path d="M9 16v23M33 16v23" stroke="#e3a865" stroke-width="3"/>',
  wheel: '<path d="M5 6h8v20H5Z" fill="#e7b660"/><circle cx="26" cy="30" r="18" fill="#30383d" stroke="#687779" stroke-width="3"/><circle cx="26" cy="30" r="10" fill="#b1babc"/><circle cx="26" cy="30" r="4" fill="#526168"/>',
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
