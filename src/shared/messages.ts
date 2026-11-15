import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

/**
 * The wire between the scene and its Multiplayer Server, built the same way as
 * Pixel Golf's ledger: messages only, no synced components. Lists of things
 * (pigeons, scores) travel as JSON strings, so adding a field never changes a
 * schema.
 *
 * THE ONE RULE (learned on Pixel Golf): never add a field to a message below
 * once it has shipped. A Schemas.Map is read back in declaration order, and a
 * client and server on different builds fail to decode each other's messages
 * altogether. When something new needs sending, add a new message instead.
 */
export const MESSAGES = {
  // -------------------------------------------------------------------------
  // Scene -> server
  // -------------------------------------------------------------------------

  /** I have arrived (sent again when the name loads). The server replies with everything. */
  hello: Schemas.Map({ version: Schemas.Int, name: Schemas.String }),

  /** Where I am, a few times a second, for catches, grabs and checking shots. */
  pos: Schemas.Map({ x: Schemas.Float, y: Schemas.Float, z: Schemas.Float }),

  /** I fired along this ray. The server decides what it hit. */
  shoot: Schemas.Map({
    ox: Schemas.Float,
    oy: Schemas.Float,
    oz: Schemas.Float,
    dx: Schemas.Float,
    dy: Schemas.Float,
    dz: Schemas.Float
  }),

  // -------------------------------------------------------------------------
  // Server -> scene
  // -------------------------------------------------------------------------

  /** The round, sent on every change and once a second (it doubles as the clock and the heartbeat). */
  round: Schemas.Map({ phase: Schemas.Int, endsAt: Schemas.Int64, round: Schemas.Int, now: Schemas.Int64 }),

  /** Every pigeon slot as JSON (PigeonWire[]), sent when any of them changes. */
  pigeons: Schemas.Map({ json: Schemas.String }),

  /** Everyone's scores as JSON (ScoreWire[]), sent when any of them changes. */
  scores: Schemas.Map({ json: Schemas.String }),

  /**
   * Something happened. kind: 'hit' | 'miss' | 'catch' | 'grab' | 'steal' | 'lost' | 'roundStart' | 'roundEnd'
   */
  event: Schemas.Map({
    kind: Schemas.String,
    who: Schemas.String, // address of the player who scored
    whoName: Schemas.String,
    other: Schemas.String, // address of the other player (whose pigeon was stolen)
    otherName: Schemas.String,
    points: Schemas.Int,
    multiplier: Schemas.Float,
    slot: Schemas.Int,
    x: Schemas.Float,
    y: Schemas.Float,
    z: Schemas.Float
  }),

  // -------------------------------------------------------------------------
  // Added 15 November for the shop, perks, Feathers and the weekly board.
  // New messages rather than new fields, as THE ONE RULE above says.
  // -------------------------------------------------------------------------

  /**
   * Scene -> server. Buy or wear something: 'gun:shotgun', 'perk:windy' (in the break),
   * 'cos:paint:pink' (buy with Feathers and wear), 'wear:paint:red' (wear one you have).
   */
  buy: Schemas.Map({ item: Schemas.String }),

  /** Scene -> server. Fire a perk you hold, during the round. */
  fire: Schemas.Map({ perk: Schemas.String }),

  /** Server -> one player. Their budget, gun, perks, level, Feathers and cosmetics as JSON (MeWire). */
  me: Schemas.Map({ json: Schemas.String }),

  /** Server -> everyone. Running perks, Golden Hour and the week as JSON (ArenaWire). */
  arena: Schemas.Map({ json: Schemas.String }),

  /** Server -> everyone. This week's scoreboard as JSON (BoardWire). */
  board: Schemas.Map({ json: Schemas.String })
}

export const room = registerMessages(MESSAGES)

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

// One pigeon slot on the wire
export type PigeonWire = {
  slot: number
  phase: number
  cannon: number
  seed: number
  t0: number // server ms
  sx: number
  sy: number
  sz: number
  owner: string // address of the player who popped it ('' while flying)
  golden: boolean
  kind?: number // PigeonKind: normal, fast, zig-zag
  slow?: boolean // popped under Slow Chutes: falls at half speed
  decoy?: boolean // a Decoys pigeon: grey parachute, popping it breaks your streak
  crate?: boolean // carries a crate: whoever collects it gets a free perk
}

// One player's score on the wire
export type ScoreWire = {
  address: string
  name: string
  colour: number
  score: number
  shotStreak: number
  catchStreak: number
  shots: number
  hits: number
  catches: number
  grabs: number
  best: number
  level?: number
  gun?: string
  paint?: string
  trace?: string
  title?: string
}
