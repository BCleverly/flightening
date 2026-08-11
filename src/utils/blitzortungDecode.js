/**
 * Blitzortung WebSocket payloads are LZW-obfuscated.
 * Port of the decoder used by map.blitzortung.org.
 */
export function decodeBlitzortung(payload) {
  const dict = {}
  const chars = payload.split('')
  if (!chars.length) return ''

  let w = chars[0]
  let entry = w
  const out = [w]
  let dictSize = 256

  for (let i = 1; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0)
    entry = code < 256 ? chars[i] : dict[code] ? dict[code] : w + w.charAt(0)
    out.push(entry)
    dict[dictSize++] = w + entry.charAt(0)
    w = entry
  }

  return out.join('')
}
