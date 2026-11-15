import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// ---------------------------------------------------------------------------
// Synced state. The Multiplayer Server is the only writer; clients only read.
// Defined at module scope so they exist before the engine seals.
// ---------------------------------------------------------------------------

export { PigeonPhase, RoundPhase } from './phases'

export const PigeonState = engine.defineComponent('ps::Pigeon', {
  slot: Schemas.Int,
  phase: Schemas.Int,
  cannon: Schemas.Int,
  seed: Schemas.Int,
  t0: Schemas.Int64, // server ms
  sx: Schemas.Float,
  sy: Schemas.Float,
  sz: Schemas.Float,
  owner: Schemas.String, // address of the player who popped it ('' while flying)
  golden: Schemas.Boolean
})


export const RoundState = engine.defineComponent('ps::Round', {
  phase: Schemas.Int,
  endsAt: Schemas.Int64, // server ms
  round: Schemas.Int
})

// Kept apart from RoundState because it changes every second
export const ServerClock = engine.defineComponent('ps::Clock', {
  now: Schemas.Int64
})

export const PlayerScore = engine.defineComponent('ps::Score', {
  address: Schemas.String,
  name: Schemas.String,
  colour: Schemas.Int,
  score: Schemas.Int,
  shotStreak: Schemas.Int,
  catchStreak: Schemas.Int,
  shots: Schemas.Int,
  hits: Schemas.Int,
  catches: Schemas.Int,
  grabs: Schemas.Int,
  best: Schemas.Int // best round score this session
})

// Server-only write guards, registered from main() on both sides (a no-op on
// clients), the same way as Decentraland's own Multiplayer Server examples.
export function registerValidators() {
  if (!isServer()) return
  const serverOnly = (v: { senderAddress: string }) => v.senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID.toLowerCase()
  PigeonState.validateBeforeChange(serverOnly)
  RoundState.validateBeforeChange(serverOnly)
  ServerClock.validateBeforeChange(serverOnly)
  PlayerScore.validateBeforeChange(serverOnly)
}
