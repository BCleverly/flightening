/** Simple map pin used by deck.gl IconLayer for airports */
export const AIRPORT_PIN_URL =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path fill="#ffffff" d="M32 4 C20 4 12 14 12 26 C12 42 32 60 32 60 C32 60 52 42 52 26 C52 14 44 4 32 4 Z"/>
  <circle fill="#0c1220" cx="32" cy="26" r="9"/>
  <path fill="#ffffff" d="M32 18 L35 24 L42 25 L36.5 30 L38 37 L32 33.5 L26 37 L27.5 30 L22 25 L29 24 Z"/>
</svg>`.trim(),
  )
