import { shallowRef, watch, onUnmounted } from 'vue'
import { destinationPoint } from '../utils/aircraft'

/** Fade position snaps into the dead-reckoned track */
const CORRECTION_MS = 2500
/** Keep coasting on last velocity if a poll is late */
const MAX_COAST_MS = 45_000
/** Max breadcrumb points retained per aircraft */
const MAX_TRAIL_POINTS = 180
/** Ignore successive poll points closer than this (meters) */
const MIN_TRAIL_SPACING_M = 120
/** Drop trails unused for this long */
const TRAIL_TTL_MS = 15 * 60_000

/**
 * Continuous aircraft motion via ground-speed dead reckoning, with soft
 * corrections when a new snapshot arrives. Also records poll breadcrumbs so
 * a selected aircraft can render its recent path.
 */
export function useAircraftInterpolation(latestTargets) {
  const frameAircraft = shallowRef([])
  const track = new Map()
  /** @type {Map<string, { points: number[][], touchedAt: number }>} */
  const trails = new Map()

  let rafId = 0
  let running = false
  let lastFrameAt = 0

  function correctionFade(now, errBorn) {
    return Math.max(0, 1 - (now - errBorn) / CORRECTION_MS)
  }

  function approxDistanceM(a, b) {
    const [lon1, lat1] = a
    const [lon2, lat2] = b
    const dy = (lat2 - lat1) * 111_320
    const dx = (lon2 - lon1) * 111_320 * Math.cos((lat1 * Math.PI) / 180)
    return Math.hypot(dx, dy)
  }

  function appendTrailPoint(id, lon, lat, alt) {
    const now = Date.now()
    let entry = trails.get(id)
    if (!entry) {
      entry = { points: [], touchedAt: now }
      trails.set(id, entry)
    }
    entry.touchedAt = now
    const point = [lon, lat, alt]
    const last = entry.points[entry.points.length - 1]
    if (last && approxDistanceM(last, point) < MIN_TRAIL_SPACING_M) {
      // Refresh the tip so altitude stays current without adding noise
      last[0] = lon
      last[1] = lat
      last[2] = alt
      return
    }
    entry.points.push(point)
    if (entry.points.length > MAX_TRAIL_POINTS) {
      entry.points.splice(0, entry.points.length - MAX_TRAIL_POINTS)
    }
  }

  function pruneTrails(nowMs = Date.now()) {
    for (const [id, entry] of trails) {
      if (nowMs - entry.touchedAt > TRAIL_TTL_MS) trails.delete(id)
    }
  }

  function upsertFromTargets(targets) {
    const now = performance.now()
    const seen = new Set()

    for (const [id, t] of targets) {
      seen.add(id)
      appendTrailPoint(id, t.longitude, t.latitude, t.altitude)

      const existing = track.get(id)

      if (!existing) {
        track.set(id, {
          id,
          callsign: t.callsign,
          color: t.color,
          longitude: t.longitude,
          latitude: t.latitude,
          altitude: t.altitude,
          heading: t.heading,
          velocity: t.velocity ?? 0,
          verticalRate: t.verticalRate ?? 0,
          reportLon: t.longitude,
          reportLat: t.latitude,
          reportAlt: t.altitude,
          reportHeading: t.heading,
          reportTime: now,
          errLon: 0,
          errLat: 0,
          errAlt: 0,
          errHeading: 0,
          errBorn: now,
        })
        continue
      }

      const ageSec = Math.max(0, (now - existing.reportTime) / 1000)
      const [predLon, predLat] = destinationPoint(
        existing.reportLon,
        existing.reportLat,
        existing.heading,
        existing.velocity * ageSec,
      )
      const predAlt = existing.reportAlt + existing.verticalRate * ageSec
      const fade = correctionFade(now, existing.errBorn)
      const visualLon = predLon + existing.errLon * fade
      const visualLat = predLat + existing.errLat * fade
      const visualAlt = predAlt + existing.errAlt * fade
      const visualHeading =
        (existing.reportHeading + existing.errHeading * fade + 360) % 360

      existing.callsign = t.callsign
      existing.color = t.color
      existing.velocity = t.velocity ?? existing.velocity
      existing.verticalRate = t.verticalRate ?? 0
      existing.reportLon = t.longitude
      existing.reportLat = t.latitude
      existing.reportAlt = t.altitude
      existing.reportHeading = t.heading
      existing.heading = t.heading
      existing.reportTime = now
      existing.errLon = visualLon - t.longitude
      existing.errLat = visualLat - t.latitude
      existing.errAlt = visualAlt - t.altitude
      existing.errHeading =
        ((((visualHeading - t.heading) % 360) + 540) % 360) - 180
      existing.errBorn = now
    }

    for (const id of track.keys()) {
      if (!seen.has(id)) track.delete(id)
    }

    pruneTrails()
  }

  function sample(now) {
    const out = []

    for (const a of track.values()) {
      const ageMs = now - a.reportTime
      if (ageMs > MAX_COAST_MS) continue

      const ageSec = Math.max(0, ageMs / 1000)
      const [predLon, predLat] = destinationPoint(
        a.reportLon,
        a.reportLat,
        a.heading,
        a.velocity * ageSec,
      )
      const predAlt = Math.max(0, a.reportAlt + a.verticalRate * ageSec)
      const fade = correctionFade(now, a.errBorn)

      a.longitude = predLon + a.errLon * fade
      a.latitude = predLat + a.errLat * fade
      a.altitude = Math.max(0, predAlt + a.errAlt * fade)
      a.heading = (a.reportHeading + a.errHeading * fade + 360) % 360

      out.push({
        id: a.id,
        callsign: a.callsign,
        position: [a.longitude, a.latitude, a.altitude],
        heading: a.heading,
        color: a.color,
        altitude: a.altitude,
      })
    }

    frameAircraft.value = out
  }

  function tick(now) {
    if (lastFrameAt && now - lastFrameAt > 2000) {
      const gap = now - lastFrameAt
      for (const a of track.values()) {
        a.reportTime += gap
        a.errBorn += gap
      }
    }
    lastFrameAt = now
    sample(now)
    if (running) rafId = requestAnimationFrame(tick)
  }

  function start() {
    if (running) return
    running = true
    lastFrameAt = 0
    rafId = requestAnimationFrame(tick)
  }

  function stop() {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  /**
   * Returns a copy of breadcrumb positions for an aircraft, optionally
   * extending the tip to the live animated position.
   */
  function getTrailPath(id, livePosition = null) {
    const entry = trails.get(id)
    if (!entry?.points?.length && !livePosition) return null
    const path = entry?.points?.length ? entry.points.map((p) => [...p]) : []
    if (livePosition) {
      const tip = path[path.length - 1]
      if (
        !tip ||
        tip[0] !== livePosition[0] ||
        tip[1] !== livePosition[1] ||
        tip[2] !== livePosition[2]
      ) {
        path.push([...livePosition])
      }
    }
    return path.length >= 2 ? path : null
  }

  const stopWatch = watch(
    latestTargets,
    (targets) => {
      if (targets) upsertFromTargets(targets)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stop()
    stopWatch()
  })

  return { frameAircraft, getTrailPath, start, stop }
}
