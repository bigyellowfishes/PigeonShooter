import { isServer } from '@dcl/sdk/network'
// Synced components and messages must be defined while the modules load, before the engine seals
import { registerValidators } from './shared/schemas'
import './shared/messages'
import { initClient } from './client/setup'

// One codebase, branched by isServer(), following Decentraland's Multiplayer Server examples.
export async function main() {
  registerValidators()
  if (isServer()) {
    const { initServer } = await import('./server/server')
    initServer()
    return
  }
  initClient()
}
