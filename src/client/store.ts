import { PigeonWire, ScoreWire } from '../shared/messages'
import { RoundPhase } from '../shared/phases'

/**
 * What this scene knows about the game, as the server last told it. Filled in by
 * the message handlers in setup.ts; read by the pigeons, the gun and the HUD.
 */

export const game = {
  round: { phase: RoundPhase.Waiting as number, endsAt: 0, round: 0 },
  pigeons: [] as PigeonWire[],
  scores: [] as ScoreWire[]
}

// ---------------------------------------------------------------------------
// Server time and liveness. The round message arrives once a second carrying
// the server's clock. Network delay only ever makes a sample look older, so the
// newest-looking of the last few samples is the best estimate of the offset.
// ---------------------------------------------------------------------------
const ALIVE_WINDOW_MS = 3500
const SAMPLES = 8
const samples: number[] = []
let offset = 0
let lastHeardAt = 0

export function noteServerTime(serverMs: number) {
  lastHeardAt = Date.now()
  samples.push(serverMs - lastHeardAt)
  if (samples.length > SAMPLES) samples.shift()
  offset = Math.max(...samples)
}

export function serverNow(): number {
  return Date.now() + offset
}

export function serverAlive(): boolean {
  return lastHeardAt > 0 && Date.now() - lastHeardAt < ALIVE_WINDOW_MS
}

export function roundIsPlaying(): boolean {
  return serverAlive() && game.round.phase === RoundPhase.Playing
}
