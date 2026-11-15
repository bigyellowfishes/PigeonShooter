import { engine } from '@dcl/sdk/ecs'
import { ServerClock } from '../shared/schemas'

// ---------------------------------------------------------------------------
// Server time on the client, and whether the Multiplayer Server is awake.
// The server pulses ServerClock.now every second. Network delay only ever makes
// a sample look older, so the newest-looking sample is the best estimate.
// The first value seen may be a stale snapshot from an earlier server run, so
// only values that change while we watch are trusted.
// ---------------------------------------------------------------------------

const ALIVE_WINDOW_MS = 3500
const SAMPLES = 8

let lastValue = -1
let lastChangeLocal = 0
let offset = 0
let haveOffset = false
const samples: number[] = []

export function setupClock() {
  engine.addSystem(() => {
    for (const [, clock] of engine.getEntitiesWith(ServerClock)) {
      const v = Number(clock.now)
      if (v === lastValue) return
      const first = lastValue === -1
      lastValue = v
      if (first) return
      lastChangeLocal = Date.now()
      samples.push(v - lastChangeLocal)
      if (samples.length > SAMPLES) samples.shift()
      offset = Math.max(...samples)
      haveOffset = true
      return
    }
  })
}

export function serverNow(): number {
  return Date.now() + offset
}

export function serverAlive(): boolean {
  return haveOffset && Date.now() - lastChangeLocal < ALIVE_WINDOW_MS
}
