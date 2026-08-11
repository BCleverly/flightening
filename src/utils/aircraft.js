/** Altitude (meters) → RGBA for deck.gl IconLayer */
export function altitudeColor(altMeters) {
  const alt = Number.isFinite(altMeters) ? altMeters : 0

  if (alt < 1500) return [56, 189, 248, 230] // cyan — low
  if (alt < 4000) return [52, 211, 153, 230] // green
  if (alt < 8000) return [251, 191, 36, 235] // amber
  if (alt < 11000) return [251, 146, 60, 240] // orange
  return [248, 113, 113, 245] // red — high cruise
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

/** Shortest-path heading interpolation (degrees) */
export function lerpHeading(from, to, t) {
  let delta = ((((to - from) % 360) + 540) % 360) - 180
  return (from + delta * t + 360) % 360
}

const EARTH_RADIUS_M = 6_371_000

/**
 * Move a lon/lat point `distanceM` meters along `headingDeg` (0 = north).
 * Returns [longitude, latitude].
 */
export function destinationPoint(lon, lat, headingDeg, distanceM) {
  if (!Number.isFinite(distanceM) || distanceM === 0) return [lon, lat]

  const δ = distanceM / EARTH_RADIUS_M
  const θ = (headingDeg * Math.PI) / 180
  const φ1 = (lat * Math.PI) / 180
  const λ1 = (lon * Math.PI) / 180

  const sinφ1 = Math.sin(φ1)
  const cosφ1 = Math.cos(φ1)
  const sinδ = Math.sin(δ)
  const cosδ = Math.cos(δ)

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ)
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)))
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2))

  return [((λ2 * 180) / Math.PI + 540) % 360 - 180, (φ2 * 180) / Math.PI]
}
