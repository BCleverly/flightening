import { ref, shallowRef, onUnmounted } from 'vue'
import { altitudeColor } from '../utils/aircraft'

const POLL_MS = 10_000
const MAX_AIRCRAFT = 2500

/**
 * OpenSky Network REST — bbox-filtered state vectors, polled every 10s.
 * Uses the Vite `/api/opensky` proxy in development to avoid CORS.
 */
export function useOpenSky() {
  const aircraftCount = ref(0)
  /** Epoch ms of last successful OpenSky response */
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

  async function fetchAircraft({ force = false } = {}) {
    const bounds = getBounds()
    if (!bounds) return
    // Don't cancel a healthy poll just because the map moved mid-request
    if (inFlight && !force) return

    const { west, south, east, north } = bounds
    const pad = 0.35
    const params = new URLSearchParams({
      lamin: String(south - pad),
      lomin: String(west - pad),
      lamax: String(north + pad),
      lomax: String(east + pad),
    })

    abortController?.abort()
    abortController = new AbortController()
    inFlight = true
    isLoading.value = true
    error.value = null

    try {
      const url = `/api/opensky/states/all?${params}`
      const res = await fetch(url, { signal: abortController.signal })
      if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`)
      const json = await res.json()
      const states = Array.isArray(json?.states) ? json.states : []

      const next = new Map()
      for (const row of states) {
        if (!row || next.size >= MAX_AIRCRAFT) break
        const icao24 = row[0]
        const lon = row[5]
        const lat = row[6]
        const baroAlt = row[7]
        const onGround = row[8]
        const velocity = row[9]
        const trueTrack = row[10]
        const verticalRate = row[11]
        const geoAlt = row[13]
        if (lon == null || lat == null || onGround) continue

        const altitude = geoAlt ?? baroAlt ?? 0
        next.set(icao24, {
          id: icao24,
          callsign: (row[1] || '').trim() || icao24,
          longitude: lon,
          latitude: lat,
          altitude: Math.max(0, altitude),
          heading: Number.isFinite(trueTrack) ? trueTrack : 0,
          velocity: Number.isFinite(velocity) ? Math.max(0, velocity) : 0,
          verticalRate: Number.isFinite(verticalRate) ? verticalRate : 0,
          color: altitudeColor(altitude),
        })
      }

      latestTargets.value = next
      aircraftCount.value = next.size
      lastFetchAt.value = Date.now()
    } catch (err) {
      if (err?.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : String(err)
      console.warn('[OpenSky]', error.value)
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
