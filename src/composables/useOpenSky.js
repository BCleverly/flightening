import { ref, shallowRef, onUnmounted } from 'vue'
import { altitudeColor } from '../utils/aircraft'

const POLL_MS = 10_000
const MAX_AIRCRAFT = 2500
/** airplanes.live point API max radius (nautical miles) */
const MAX_RADIUS_NM = 250
const KT_TO_MS = 0.514444
const FPM_TO_MS = 0.00508
const FT_TO_M = 0.3048

/**
 * Live aircraft via airplanes.live (readsb-compatible), which allows browser
 * CORS — required for static production hosts where a Vite OpenSky proxy
 * does not exist.
 *
 * Docs: https://airplanes.live/data-feed-api/
 * Endpoint: /v2/point/{lat}/{lon}/{radiusNm}
 */
export function useOpenSky() {
  const aircraftCount = ref(0)
  /** Epoch ms of last successful aircraft response */
  const lastFetchAt = ref(null)
  /** Epoch ms when the next scheduled poll should fire */
  const nextFetchAt = ref(null)
  const isLoading = ref(false)
  const error = ref(null)
  /** Latest raw target vectors keyed by icao24 — consumed by the interpolator */
  const latestTargets = shallowRef(new Map())

  let timer = null
  let abortController = null
  let getBounds = () => null
  let inFlight = false

  function setBoundsGetter(fn) {
    getBounds = fn
  }

  function boundsToQuery(bounds) {
    const { west, south, east, north } = bounds
    const lat = (south + north) / 2
    const lon = (west + east) / 2

    // Approx km span → nm radius that covers the viewport
    const latSpanKm = Math.abs(north - south) * 111.32
    const lonSpanKm =
      Math.abs(east - west) * 111.32 * Math.cos((lat * Math.PI) / 180)
    const halfDiagKm = Math.hypot(latSpanKm, lonSpanKm) / 2
    const radiusNm = Math.min(
      MAX_RADIUS_NM,
      Math.max(40, Math.ceil((halfDiagKm / 1.852) * 1.05)),
    )

    return { lat, lon, radiusNm }
  }

  function parseAltitudeMeters(ac) {
    const raw = ac.alt_geom ?? ac.alt_baro
    if (raw == null || raw === 'ground') return null
    const ft = Number(raw)
    if (!Number.isFinite(ft)) return null
    return Math.max(0, ft * FT_TO_M)
  }

  async function fetchAircraft({ force = false } = {}) {
    const bounds = getBounds()
    if (!bounds) return
    if (inFlight && !force) return

    const { lat, lon, radiusNm } = boundsToQuery(bounds)
    const url = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`

    abortController?.abort()
    abortController = new AbortController()
    inFlight = true
    isLoading.value = true
    error.value = null

    try {
      const res = await fetch(url, {
        signal: abortController.signal,
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`Aircraft API HTTP ${res.status}`)
      const json = await res.json()
      const rows = Array.isArray(json?.ac) ? json.ac : []

      const next = new Map()
      for (const ac of rows) {
        if (!ac || next.size >= MAX_AIRCRAFT) break
        const icao24 = (ac.hex || '').toLowerCase()
        const longitude = ac.lon
        const latitude = ac.lat
        if (!icao24 || longitude == null || latitude == null) continue

        const altitude = parseAltitudeMeters(ac)
        if (altitude == null) continue // on ground / unknown

        const gsKt = Number(ac.gs)
        const track = Number(ac.true_heading ?? ac.track)
        const vrateFpm = Number(ac.geom_rate ?? ac.baro_rate)

        next.set(icao24, {
          id: icao24,
          callsign: (ac.flight || '').trim() || icao24,
          longitude,
          latitude,
          altitude,
          heading: Number.isFinite(track) ? track : 0,
          velocity: Number.isFinite(gsKt) ? Math.max(0, gsKt * KT_TO_MS) : 0,
          verticalRate: Number.isFinite(vrateFpm) ? vrateFpm * FPM_TO_MS : 0,
          color: altitudeColor(altitude),
        })
      }

      latestTargets.value = next
      aircraftCount.value = next.size
      lastFetchAt.value = Date.now()
    } catch (err) {
      if (err?.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : String(err)
      console.warn('[Aircraft]', error.value)
    } finally {
      inFlight = false
      isLoading.value = false
    }
  }

  function scheduleLoop() {
    nextFetchAt.value = Date.now() + POLL_MS
    timer = window.setTimeout(async () => {
      await fetchAircraft()
      scheduleLoop()
    }, POLL_MS)
  }

  function start(boundsGetter) {
    if (boundsGetter) setBoundsGetter(boundsGetter)
    nextFetchAt.value = Date.now()
    fetchAircraft({ force: true })
    scheduleLoop()
  }

  function stop() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    abortController?.abort()
    inFlight = false
    nextFetchAt.value = null
  }

  onUnmounted(stop)

  return {
    POLL_MS,
    aircraftCount,
    lastFetchAt,
    nextFetchAt,
    isLoading,
    error,
    latestTargets,
    setBoundsGetter,
    fetchAircraft,
    start,
    stop,
  }
}
