import { ref, onUnmounted } from 'vue'

const RAINVIEWER_MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const UPDATE_MS = 5 * 60 * 1000

/**
 * Fetches the latest RainViewer radar host + frame path and refreshes every 5 minutes.
 *
 * Tile URL (current RainViewer scheme):
 *   `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`
 * where `path` looks like `/v2/radar/<hash>` (Unix-time paths now return 410).
 */
export function useRainViewer() {
  const radarTimestamp = ref(null)
  const radarPath = ref(null)
  const radarHost = ref('https://tilecache.rainviewer.com')
  const lastUpdatedAt = ref(null)
  const isUpdating = ref(false)
  const error = ref(null)

  let timer = null

  async function fetchRadarMeta() {
    isUpdating.value = true
    error.value = null
    try {
      const res = await fetch(RAINVIEWER_MAPS_URL)
      if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`)
      const data = await res.json()
      const frames = data?.radar?.past ?? []
      const latest = frames[frames.length - 1]
      if (!latest?.path) throw new Error('No radar frames available')

      radarHost.value = data.host?.startsWith('http')
        ? data.host
        : `https://${data.host}`
      radarPath.value = latest.path
      radarTimestamp.value = latest.time ?? null
      lastUpdatedAt.value = Date.now()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.warn('[RainViewer]', error.value)
    } finally {
      isUpdating.value = false
    }
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
  }

  function tileUrlTemplate() {
    if (!radarPath.value) return null
    const host = radarHost.value.replace(/\/$/, '')
    const path = radarPath.value.startsWith('/')
      ? radarPath.value
      : `/${radarPath.value}`
    return `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`
  }

  onUnmounted(stop)

  return {
    radarTimestamp,
    radarPath,
    radarHost,
    lastUpdatedAt,
    isUpdating,
    error,
    start,
    stop,
    tileUrlTemplate,
  }
}
