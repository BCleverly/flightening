import { ref, onUnmounted } from 'vue'

const RAINVIEWER_MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const UPDATE_MS = 5 * 60 * 1000

/**
 * Fetches the latest RainViewer radar host + timestamp and refreshes every 5 minutes.
 * Tile URL: `${host}/v2/radar/{timestamp}/256/{z}/{x}/{y}/2/1_1.png`
 */
export function useRainViewer() {
  const radarTimestamp = ref(null)
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
      if (!latest?.time) throw new Error('No radar frames available')

      radarHost.value = data.host?.startsWith('http')
        ? data.host
        : `https://${data.host}`
      radarTimestamp.value = latest.time
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
    if (!radarTimestamp.value) return null
    const host = radarHost.value.replace(/\/$/, '')
    return `${host}/v2/radar/${radarTimestamp.value}/256/{z}/{x}/{y}/2/1_1.png`
  }

  onUnmounted(stop)

  return {
    radarTimestamp,
    radarHost,
    lastUpdatedAt,
    isUpdating,
    error,
    start,
    stop,
    tileUrlTemplate,
  }
}
