<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import StatsPanel from './StatsPanel.vue'
import { useRainViewer, RADAR_TILE_SIZE, RADAR_MAX_ZOOM } from '../composables/useRainViewer'
import { useOpenSky } from '../composables/useOpenSky'
import { useAircraftInterpolation } from '../composables/useAircraftInterpolation'
import { useBlitzortung } from '../composables/useBlitzortung'
import { PLANE_ICON_URL } from '../utils/planeIcon'
import { AIRPORT_PIN_URL } from '../utils/airportIcon'
import airports from '../data/airports.json'

// MapLibre v6 ships the tile worker separately; Vite must emit it explicitly
setWorkerUrl(maplibreWorkerUrl)

// Free dark vector basemap — no API key / billing (OpenFreeMap + MapLibre)
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

// Central Europe — dense traffic corridor with room for 3D pitch
const INITIAL = {
  center: [8.5, 49.5],
  zoom: 5.4,
  pitch: 45,
  bearing: -12,
}

const mapContainer = ref(null)
let map = null
let deckOverlay = null
let moveEndHandler = null

const {
  radarTimestamp,
  radarPath,
  isUpdating: radarUpdating,
  rateLimited: radarRateLimited,
  start: startRainViewer,
  stop: stopRainViewer,
  tileUrlTemplate,
  noteTileFailure,
  isInCooldown,
} = useRainViewer()

const EMPTY_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let mapErrorHandler = null
let lastRadarTemplate = null

const {
  aircraftCount,
  lastFetchAt,
  nextFetchAt,
  isLoading: aircraftLoading,
  latestTargets,
  fetchAircraft,
  start: startOpenSky,
  stop: stopOpenSky,
} = useOpenSky()

const {
  strikesLast60s,
  connected: lightningConnected,
  getStrikeVisuals,
  start: startLightning,
  stop: stopLightning,
} = useBlitzortung()

const { frameAircraft, start: startInterpolation, stop: stopInterpolation } =
  useAircraftInterpolation(latestTargets)

function getViewportBounds() {
  if (!map) return null
  const b = map.getBounds()
  return {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  }
}

function findLabelLayerId() {
  if (!map) return undefined
  const layers = map.getStyle()?.layers ?? []
  const label = layers.find(
    (l) =>
      l.type === 'symbol' &&
      (l.id.includes('label') || l.id.includes('place') || l.id.includes('road')),
  )
  return label?.id
}

function buildLayers() {
  const now = performance.now()
  const strikeData = getStrikeVisuals(now)
  const zoom = map?.getZoom?.() ?? INITIAL.zoom

  // Pins always; labels only when close enough to avoid clutter
  const showAirportLabels = zoom >= 5.2
  const pinSize = Math.min(22, Math.max(10, (zoom - 2.5) * 3.2))

  const airportPins = new IconLayer({
    id: 'airports',
    data: airports,
    pickable: true,
    billboard: true,
    sizeScale: 1,
    sizeMinPixels: 10,
    sizeMaxPixels: 24,
    getIcon: () => ({
      url: AIRPORT_PIN_URL,
      width: 64,
      height: 64,
      anchorY: 64,
      mask: true,
    }),
    getPosition: (d) => d.position,
    getSize: pinSize,
    getColor: [148, 163, 184, 220],
    updateTriggers: {
      getSize: zoom,
    },
  })

  const airportLabels = new TextLayer({
    id: 'airport-labels',
    data: showAirportLabels ? airports : [],
    pickable: false,
    billboard: true,
    sizeUnits: 'pixels',
    getText: (d) => d.iata,
    getPosition: (d) => d.position,
    getSize: 11,
    getColor: [226, 232, 240, 230],
    getPixelOffset: [0, -28],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'bottom',
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontWeight: 500,
    outlineWidth: 2,
    outlineColor: [12, 18, 28, 200],
    characterSet: 'auto',
  })

  const aircraftLayer = new IconLayer({
    id: 'aircraft',
    data: frameAircraft.value,
    pickable: true,
    billboard: true,
    sizeScale: 1,
    sizeMinPixels: 14,
    sizeMaxPixels: 36,
    getIcon: () => ({
      url: PLANE_ICON_URL,
      width: 64,
      height: 64,
      anchorY: 32,
      mask: true,
    }),
    getPosition: (d) => d.position,
    getSize: 22,
    getColor: (d) => d.color,
    // OpenSky true_track: degrees clockwise from north; icon nose points up
    getAngle: (d) => -d.heading,
    updateTriggers: {
      getPosition: now,
      getAngle: now,
      getColor: lastFetchAt.value,
    },
  })

  const lightningGlow = new ScatterplotLayer({
    id: 'lightning-glow',
    data: strikeData,
    pickable: false,
    opacity: 1,
    stroked: false,
    filled: true,
    radiusUnits: 'meters',
    radiusMinPixels: 2,
    radiusMaxPixels: 80,
    getPosition: (d) => d.position,
    getRadius: (d) => d.radius * 1.65,
    getFillColor: (d) => [254, 240, 138, Math.round(d.opacity * 90)],
    updateTriggers: {
      getRadius: now,
      getFillColor: now,
    },
  })

  const lightningCore = new ScatterplotLayer({
    id: 'lightning-core',
    data: strikeData,
    pickable: false,
    opacity: 1,
    stroked: false,
    filled: true,
    radiusUnits: 'meters',
    radiusMinPixels: 1,
    radiusMaxPixels: 28,
    getPosition: (d) => d.position,
    getRadius: (d) => d.radius * 0.35,
    getFillColor: (d) => [255, 255, 255, Math.round(d.opacity * 255)],
    updateTriggers: {
      getRadius: now,
      getFillColor: now,
    },
  })

  // Airports under dynamic layers so planes/lightning stay on top
  return [airportPins, airportLabels, lightningGlow, lightningCore, aircraftLayer]
}

function syncDeckLayers() {
  if (!deckOverlay) return
  deckOverlay.setProps({ layers: buildLayers() })
}

let layerRaf = 0
function layerLoop() {
  syncDeckLayers()
  layerRaf = requestAnimationFrame(layerLoop)
}

function removeRadarLayer() {
  if (!map) return
  if (map.getLayer('rainviewer-radar-layer')) map.removeLayer('rainviewer-radar-layer')
  if (map.getSource('rainviewer-radar')) map.removeSource('rainviewer-radar')
  lastRadarTemplate = null
}

function upsertRadarLayer() {
  if (!map || !map.isStyleLoaded()) return

  if (isInCooldown()) {
    removeRadarLayer()
    return
  }

  const template = tileUrlTemplate()
  if (!template) {
    removeRadarLayer()
    return
  }

  // Avoid setTiles() churn — each call invalidates the cache and can trigger a 429 storm
  if (template === lastRadarTemplate && map.getSource('rainviewer-radar')) return
  lastRadarTemplate = template

  const sourceId = 'rainviewer-radar'
  const layerId = 'rainviewer-radar-layer'

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setTiles([template])
  } else {
    map.addSource(sourceId, {
      type: 'raster',
      tiles: [template],
      tileSize: RADAR_TILE_SIZE,
      maxzoom: RADAR_MAX_ZOOM,
      attribution: 'RainViewer',
    })
    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 0.55,
          'raster-fade-duration': 0,
        },
      },
      findLabelLayerId(),
    )
  }
}

watch([radarPath, radarRateLimited], () => upsertRadarLayer())

onMounted(() => {
  map = new MapLibreMap({
    container: mapContainer.value,
    style: MAP_STYLE,
    center: INITIAL.center,
    zoom: INITIAL.zoom,
    pitch: INITIAL.pitch,
    bearing: INITIAL.bearing,
    antialias: true,
    attributionControl: {
      compact: true,
    },
    transformRequest: (url) => {
      // Stop hammering RainViewer while rate-limited (also avoids CORS-less 429 noise)
      if (isInCooldown() && url.includes('tilecache.rainviewer.com')) {
        return { url: EMPTY_TILE }
      }
      return { url }
    },
  })

  map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right')
  map.addControl(new ScaleControl({ maxWidth: 120 }), 'bottom-left')

  mapErrorHandler = (e) => {
    const msg = String(e?.error?.message || '')
    if (!msg.includes('rainviewer') && !msg.includes('tilecache.rainviewer')) return
    const statusMatch = msg.match(/\((\d{3})\)/)
    const status = statusMatch ? Number(statusMatch[1]) : null
    // NetworkError/CORS often means a stripped 429 response
    if (status === 429 || status === 410 || msg.includes('NetworkError')) {
      noteTileFailure(status === 410 ? 410 : 429)
      removeRadarLayer()
    }
  }
  map.on('error', mapErrorHandler)

  map.on('load', () => {
    // MapboxOverlay is MapLibre-compatible (same control / camera API)
    deckOverlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: ({ object }) => {
        if (!object) return null
        const style = {
          background: 'rgba(12,18,28,0.9)',
          color: '#e2e8f0',
          fontSize: '12px',
          padding: '6px 8px',
          borderRadius: '8px',
        }
        if (object.iata) {
          const place = [object.city, object.country].filter(Boolean).join(', ')
          return {
            html: `<strong>${object.iata}</strong> · ${object.name}${
              place ? `<br/><span style="opacity:.75">${place}</span>` : ''
            }`,
            style,
          }
        }
        if (object.callsign) {
          return {
            html: `<strong>${object.callsign}</strong><br/>${Math.round(object.altitude)} m`,
            style,
          }
        }
        return null
      },
    })
    map.addControl(deckOverlay)

    upsertRadarLayer()
    startRainViewer()
    startOpenSky(getViewportBounds)
    startLightning()
    startInterpolation()
    layerLoop()

    moveEndHandler = () => fetchAircraft()
    map.on('moveend', moveEndHandler)
  })
})

onUnmounted(() => {
  cancelAnimationFrame(layerRaf)
  stopInterpolation()
  stopOpenSky()
  stopRainViewer()
  stopLightning()
  if (map && moveEndHandler) map.off('moveend', moveEndHandler)
  if (map && mapErrorHandler) map.off('error', mapErrorHandler)
  if (deckOverlay && map) {
    try {
      map.removeControl(deckOverlay)
    } catch {
      /* map may already be torn down */
    }
  }
  deckOverlay = null
  map?.remove()
  map = null
})
</script>

<template>
  <div class="relative h-[100dvh] w-screen overflow-hidden bg-[var(--bg-deep)]">
    <div ref="mapContainer" class="absolute inset-0 h-full w-full" />

    <StatsPanel
      :aircraft-count="aircraftCount"
      :lightning-count="strikesLast60s"
      :radar-updating="radarUpdating"
      :radar-timestamp="radarTimestamp"
      :radar-rate-limited="radarRateLimited"
      :lightning-connected="lightningConnected"
      :aircraft-loading="aircraftLoading"
      :aircraft-updated-at="lastFetchAt"
      :aircraft-next-at="nextFetchAt"
    />
  </div>
</template>
