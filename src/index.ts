import { isServer } from '@dcl/sdk/network'
// Synced components and messages must be defined while the modules load, before the engine seals
import './shared/schemas'
import './shared/messages'

export async function main() {
  if (isServer()) {
    const { initServer } = await import('./server/server')
    initServer()
    return
  }
  const { initClient } = await import('./client/setup')
  initClient()
}
