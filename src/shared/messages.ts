import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

// Clients send intent (I joined, I fired along this ray). The server decides
// every result and tells everyone what happened.
export const Messages = {
  // Client -> server
  hello: Schemas.Map({ name: Schemas.String }),
  shoot: Schemas.Map({
    ox: Schemas.Float,
    oy: Schemas.Float,
    oz: Schemas.Float,
    dx: Schemas.Float,
    dy: Schemas.Float,
    dz: Schemas.Float
  }),

  // Server -> clients
  // kind: 'hit' | 'miss' | 'catch' | 'grab' | 'steal' | 'lost' | 'roundStart' | 'roundEnd'
  event: Schemas.Map({
    kind: Schemas.String,
    who: Schemas.String, // address of the player who scored
    whoName: Schemas.String,
    other: Schemas.String, // address of the other player (the victim of a steal)
    otherName: Schemas.String,
    points: Schemas.Int,
    multiplier: Schemas.Float,
    slot: Schemas.Int,
    x: Schemas.Float,
    y: Schemas.Float,
    z: Schemas.Float
  })
}

export const room = registerMessages(Messages)

export type GameEvent = {
  kind: string
  who: string
  whoName: string
  other: string
  otherName: string
  points: number
  multiplier: number
  slot: number
  x: number
  y: number
  z: number
}
