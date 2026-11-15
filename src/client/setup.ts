import { engine } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { setupClock } from './clock'
import { setupPigeons } from './pigeons'
import { setupShooting } from './shooting'
import { getMyAddress, getMyName, onGameEvent } from './state'
import { setupUi } from './ui'

export function initClient() {
  setupClock()
  setupPigeons()
  setupShooting()
  setupUi()

  room.onMessage('event', (data) => onGameEvent(data))

  // Introduce ourselves once the room is connected and our name is known
  let introduced = false
  engine.addSystem(() => {
    if (introduced || !isStateSyncronized()) return
    if (!getMyAddress()) return
    introduced = true
    void room.send('hello', { name: getMyName() })
  })
}
