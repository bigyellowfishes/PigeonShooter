import { isServer } from '@dcl/sdk/network'
import { setupClient } from './client/setup'
import { runServer } from './server/server'

// Set up the same way as Pixel Golf: one synchronous main(), branched by isServer().
// The Multiplayer Server runs the game (src/server/server.ts); every player's
// scene draws it and sends their shots (src/client).
export function main() {
  if (isServer()) {
    runServer()
    return
  }
  setupClient()
}
