import { ref, onUnmounted } from 'vue'

const RAINVIEWER_MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const UPDATE_MS = 5 * 60 * 1000
/** Larger tiles = far fewer HTTP requests (helps stay under RainViewer rate limits) */
export const RADAR_TILE_SIZE = 512
/** Overzoom past this instead of requesting more tile URLs */
export const RADAR_MAX_ZOOM = 6

/**
 * Fetches the latest RainViewer radar host + frame path and refreshes every 5 minutes.
 *
 * Tile URL (current RainViewer scheme):
 *   `${host}${path}/${size}/{z}/{x}/{y}/2/1_1.png`
 * where `path` looks like `/v2/radar/<hash>` (Unix-time paths now return 410).
 */
export function useRainViewer() {
  const radarTimestamp = ref(null)
  const radarPath = ref(null)
  const radarHost = ref('https://tilecache.rainviewer.com')
  const lastUpdatedAt = ref(null)
  const isUpdating = ref(false)
  const error = ref(null)
  /** True while we are backing off after HTTP 429/rate-limit noise */
  const rateLimited = ref(false)

  let timer = null
  let cooldownTimer = null
  let cooldownUntil = 0

  async function fetchRadarMeta() {
    if (Date.now() < cooldownUntil) return

    isUpdating.value = true
    error.value = null
    try {
      const res = await fetch(RAINVIEWER_MAPS_URL)
      if (res.status === 429) {
        beginCooldown('Radar metadata rate-limited')
        return
      }
      if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`)
      const data = await res.json()
      const frames = data?.radar?.past ?? []
      const latest = frames[frames.length - 1]
      if (!latest?.path) throw new Error('No radar frames available')

      const nextHost = data.host?.startsWith('http')
        ? data.host
        : `https://${data.host}`
      const nextPath = latest.path

      // Avoid pointless reactive churn / MapLibre tile invalidation
      if (nextPath === radarPath.value && nextHost === radarHost.value) {
        lastUpdatedAt.value = Date.now()
        return
      }

      radarHost.value = nextHost
      radarPath.value = nextPath
      radarTimestamp.value = latest.time ?? null
      lastUpdatedAt.value = Date.now()
      rateLimited.value = false
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.warn('[RainViewer]', error.value)
    } finally {
      isUpdating.value = false
    }
  }

  function beginCooldown(reason, ms = 120_000) {
    cooldownUntil = Date.now() + ms
    rateLimited.value = true
    error.value = reason
    console.warn(`[RainViewer] ${reason}; pausing tile requests for ${Math.round(ms / 1000)}s`)
    if (cooldownTimer != null) clearTimeout(cooldownTimer)
    cooldownTimer = window.setTimeout(() => {
      cooldownTimer = null
      rateLimited.value = false
      fetchRadarMeta()
    }, ms)
  }

  function noteTileFailure(status) {
    if (status === 429 || status === 410) {
      beginCooldown(
        status === 429
          ? 'Radar tile rate-limit (429)'
          : 'Radar frame expired (410)',
        status === 429 ? 120_000 : 15_000,
      )
    }
  }

  function isInCooldown() {
    return Date.now() < cooldownUntil
  }

  function start() {
    fetchRadarMeta()
    timer = window.setInterval(fetchRadarMeta, UPDATE_MS)
  }

  function stop() {
    if (timer != null) {
      clearInterval(timer)
      timer = null
    }
    if (cooldownTimer != null) {
      clearTimeout(cooldownTimer)
      cooldownTimer = null
    }
  }

  function tileUrlTemplate() {
    if (!radarPath.value || isInCooldown()) return null
    const host = radarHost.value.replace(/\/$/, '')
    const path = radarPath.value.startsWith('/')
      ? radarPath.value
      : `/${radarPath.value}`
    return `${host}${path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/2/1_1.png`
  }

  onUnmounted(stop)

  return {
    radarTimestamp,
    radarPath,
    radarHost,
    lastUpdatedAt,
    isUpdating,
    rateLimited,
    error,
    start,
    stop,
    tileUrlTemplate,
    noteTileFailure,
    isInCooldown,
    beginCooldown,
  }
}
