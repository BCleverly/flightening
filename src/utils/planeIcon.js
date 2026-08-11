/** Lightweight plane silhouette used by deck.gl IconLayer auto-packing */
export const PLANE_ICON_URL =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path fill="#ffffff" d="M32 2 L37 24 L60 30 L60 34 L37 36 L34 58 L38 62 L26 62 L30 58 L27 36 L4 34 L4 30 L27 24 Z"/>
</svg>`.trim(),
  )