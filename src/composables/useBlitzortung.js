import { ref, shallowRef, computed, onUnmounted } from 'vue'
import { decodeBlitzortung } from '../utils/blitzortungDecode'

const WS_HOSTS = [
  'wss://ws1.blitzortung.org/',
  'wss://ws7.blitzortung.org/',
  'wss://ws8.blitzortung.org/',
]
const MAX_STRIKES = 200
const FLASH_MS = 1500
const RECONNECT_BASE_MS = 1200
const RECONNECT_MAX_MS = 15_000

/**
 * Real-time Blitzortung lightning client with LZW decode + reconnect.
 * Strikes expire after FLASH_MS; capped at MAX_STRIKES.
 */
export function useBlitzortung() {
  const strikes = shallowRef([])
  const connected = ref(false)
  const error = ref(null)
  const strikesLast60s = ref(0)

  let ws = null
  let hostIndex = 0
  let reconnectAttempt = 0
  let reconnectTimer = null
  let pruneTimer = null
  let intentionalClose = false
  let idSeq = 0
  const recentTimes = []

  const activeStrikeCount = computed(() => strikes.value.length)

  function recordStrikeTime(ts) {
    const now = Date.now()
    recentTimes.push(ts ?? now)
    const cutoff = now - 60_000
    while (recentTimes.length && recentTimes[0] < cutoff) recentTimes.shift()
    strikesLast60s.value = recentTimes.length
  }

  function prune() {
    const now = performance.now()
    const next = strikes.value.filter((s) => now - s.bornAt < FLASH_MS)
    if (next.length !== strikes.value.length) {
      strikes.value = next
    }
    const cutoff = Date.now() - 60_000
    while (recentTimes.length && recentTimes[0] < cutoff) recentTimes.shift()
    strikesLast60s.value = recentTimes.length
  }

  function pushStrike(lat, lon, time) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    const bornAt = performance.now()
    const strike = {
      id: `s-${++idSeq}`,
      position: [lon, lat, 0],
      bornAt,
      time: time ?? Date.now(),
    }
    const list = strikes.value.length >= MAX_STRIKES
      ? strikes.value.slice(-(MAX_STRIKES - 1))
      : strikes.value.slice()
    list.push(strike)
    strikes.value = list
    recordStrikeTime(strike.time)
  }

  function handleMessage(raw) {
    try {
      let text = typeof raw === 'string' ? raw : String(raw)
      // Messages may arrive already-JSON or LZW-obfuscated
      let data
      try {
        data = JSON.parse(text)
      } catch {
        text = decodeBlitzortung(text)
        data = JSON.parse(text)
      }

      const lat = data.lat ?? data.latitude
      const lon = data.lon ?? data.lng ?? data.longitude
      const time = data.time ?? data.timestamp
      if (lat != null && lon != null) {
        pushStrike(Number(lat), Number(lon), Number(time) || Date.now())
      }
    } catch (err) {
      // Ignore keepalives / undecodable frames
    }
  }

  function connect() {
    intentionalClose = false
    const url = WS_HOSTS[hostIndex % WS_HOSTS.length]
    try {
      ws = new WebSocket(url)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      connected.value = true
      error.value = null
      reconnectAttempt = 0
      // Subscription handshake required by Blitzortung
      ws?.send(JSON.stringify({ a: 111 }))
    }

    ws.onmessage = (ev) => handleMessage(ev.data)

    ws.onerror = () => {
      error.value = 'WebSocket error'
    }

    ws.onclose = () => {
      connected.value = false
      ws = null
      if (!intentionalClose) {
        hostIndex = (hostIndex + 1) % WS_HOSTS.length
        scheduleReconnect()
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer != null || intentionalClose) return
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** reconnectAttempt + Math.random() * 400,
    )
    reconnectAttempt += 1
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function start() {
    connect()
    pruneTimer = window.setInterval(prune, 100)
  }

  function stop() {
    intentionalClose = true
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (pruneTimer != null) {
      clearInterval(pruneTimer)
      pruneTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected.value = false
  }

  /** Age-normalized strike props for ScatterplotLayer (0 → 1 over FLASH_MS) */
  function getStrikeVisuals(now = performance.now()) {
    return strikes.value.map((s) => {
      const age = Math.min(1, Math.max(0, (now - s.bornAt) / FLASH_MS))
      const fade = 1 - age
      return {
        ...s,
        radius: 22_000 * fade + 800,
        opacity: fade * fade,
      }
    })
  }

  onUnmounted(stop)

  return {
    FLASH_MS,
    strikes,
    connected,
    error,
    strikesLast60s,
    activeStrikeCount,
    getStrikeVisuals,
    start,
    stop,
  }
}
