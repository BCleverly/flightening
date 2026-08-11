<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  aircraftCount: { type: Number, default: 0 },
  lightningCount: { type: Number, default: 0 },
  radarUpdating: { type: Boolean, default: false },
  radarTimestamp: { type: Number, default: null },
  lightningConnected: { type: Boolean, default: false },
  aircraftLoading: { type: Boolean, default: false },
  /** Epoch ms — last successful OpenSky aircraft poll */
  aircraftUpdatedAt: { type: Number, default: null },
  /** Epoch ms — next scheduled OpenSky poll */
  aircraftNextAt: { type: Number, default: null },
})

const now = ref(Date.now())
let tickTimer = null

onMounted(() => {
  tickTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 250)
})

onUnmounted(() => {
  if (tickTimer != null) clearInterval(tickTimer)
})

function formatRadarTime(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatClock(ms) {
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatAgo(ms) {
  if (ms == null) return 'waiting…'
  const sec = Math.max(0, Math.floor((now.value - ms) / 1000))
  if (sec < 1) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s ago`
}

function formatUntil(ms) {
  if (props.aircraftLoading) return 'fetching…'
  if (ms == null) return '—'
  const sec = Math.ceil((ms - now.value) / 1000)
  if (sec <= 0) return 'due now'
  return `in ${sec}s`
}

const lastLabel = computed(() => formatAgo(props.aircraftUpdatedAt))
const nextLabel = computed(() => formatUntil(props.aircraftNextAt))
const lastClock = computed(() => formatClock(props.aircraftUpdatedAt))
</script>

<template>
  <aside
    class="pointer-events-none absolute left-4 top-4 z-10 w-[min(100vw-2rem,20rem)] select-none"
    aria-label="Live dashboard stats"
  >
    <div
      class="pointer-events-auto rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-2xl backdrop-blur-xl"
    >
      <header class="mb-4 flex items-baseline justify-between gap-3">
        <h1
          class="text-lg font-semibold tracking-tight text-[var(--text-primary)]"
          style="font-feature-settings: 'ss01'"
        >
          Flightening
        </h1>
        <span
          class="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
        >
          Live
        </span>
      </header>

      <dl class="space-y-3">
        <div class="flex items-end justify-between gap-3">
          <dt class="text-sm text-[var(--text-muted)]">Aircraft on screen</dt>
          <dd
            class="font-mono text-2xl font-medium tabular-nums leading-none text-[var(--accent-cyan)]"
          >
            {{ aircraftCount.toLocaleString() }}
            <span
              v-if="aircraftLoading"
              class="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-cyan)] align-middle opacity-70"
            />
          </dd>
        </div>

        <div class="rounded-xl bg-white/[0.03] px-3 py-2">
          <div class="flex items-center justify-between gap-3 text-xs">
            <span class="text-[var(--text-muted)]">Last update</span>
            <span
              class="font-mono tabular-nums text-[var(--text-primary)]"
              :title="lastClock"
            >
              {{ lastLabel }}
            </span>
          </div>
          <div class="mt-1.5 flex items-center justify-between gap-3 text-xs">
            <span class="text-[var(--text-muted)]">Next poll</span>
            <span
              class="font-mono tabular-nums"
              :class="
                aircraftLoading
                  ? 'text-[var(--accent-amber)]'
                  : 'text-[var(--text-primary)]'
              "
            >
              {{ nextLabel }}
            </span>
          </div>
        </div>

        <div class="flex items-end justify-between gap-3">
          <dt class="text-sm text-[var(--text-muted)]">
            Lightning
            <span class="text-[var(--text-muted)]/70">· 60s</span>
          </dt>
          <dd
            class="font-mono text-2xl font-medium tabular-nums leading-none text-[var(--accent-strike)]"
          >
            {{ lightningCount.toLocaleString() }}
            <span
              class="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
              :class="
                lightningConnected
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : 'bg-slate-500'
              "
              :title="lightningConnected ? 'Blitzortung connected' : 'Reconnecting…'"
            />
          </dd>
        </div>

        <div
          class="flex items-center justify-between gap-3 border-t border-white/5 pt-3"
        >
          <dt class="text-sm text-[var(--text-muted)]">Radar frame</dt>
          <dd class="flex items-center gap-2 font-mono text-xs text-[var(--text-primary)]">
            <span
              class="inline-block h-2 w-2 rounded-full transition-all duration-500"
              :class="
                radarUpdating
                  ? 'animate-pulse bg-[var(--accent-amber)] shadow-[0_0_10px_rgba(251,191,36,0.9)]'
                  : 'bg-sky-400/80'
              "
              :title="radarUpdating ? 'Refreshing radar…' : 'Radar up to date'"
            />
            {{ formatRadarTime(radarTimestamp) }}
          </dd>
        </div>
      </dl>
    </div>
  </aside>
</template>
