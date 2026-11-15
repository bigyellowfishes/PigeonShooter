import { engine, Transform } from '@dcl/sdk/ecs'
import { PigeonWire, room, ScoreWire } from '../shared/messages'
import { setupPigeons } from './pigeons'
import { setupShooting } from './shooting'
import { getMyName, onGameEvent } from './state'
import { game, noteServerTime, serverAlive } from './store'
import { setupUi } from './ui'

const POS_EVERY = 0.2 // seconds between position reports
const HELLO_RETRY = 5 // say hello again if the server hasn't answered

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

export function setupClient() {
  room.onMessage('round', (d) => {
    game.round = { phase: d.phase, endsAt: Number(d.endsAt), round: d.round }
    noteServerTime(Number(d.now))
  })
  room.onMessage('pigeons', (d) => {
    game.pigeons = parse<PigeonWire[]>(d.json, game.pigeons)
  })
  room.onMessage('scores', (d) => {
    game.scores = parse<ScoreWire[]>(d.json, game.scores)
  })
  room.onMessage('event', (d) => onGameEvent(d))

  setupPigeons()
  setupShooting()
  setupUi()

  // Messages sent before the room connects are queued, so hello can go now.
  // Say it again once the name loads, and again if the server hasn't answered yet
  // (it may have been asleep and only just woken up).
  const greet = () => void room.send('hello', { version: 1, name: getMyName() })
  greet()
  let greetedAs = getMyName()
  let helloClock = 0
  let posClock = 0
  engine.addSystem((dt) => {
    const name = getMyName()
    if (name !== greetedAs) {
      greetedAs = name
      greet()
    }
    helloClock += dt
    if (!serverAlive() && helloClock >= HELLO_RETRY) {
      helloClock = 0
      greet()
    }
    posClock += dt
    if (posClock >= POS_EVERY) {
      posClock = 0
      const t = Transform.getOrNull(engine.PlayerEntity)
      if (t) void room.send('pos', { x: t.position.x, y: t.position.y, z: t.position.z })
    }
  })
}
