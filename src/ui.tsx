import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, PointerLock } from '@dcl/sdk/ecs'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(CrosshairUi)
}

const CrosshairUi = () => {
  // Check if the player's cursor is locked in camera-control mode
  const isLocked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? false

  // Hide the crosshair when the player unlocks their cursor (Right-Click / Esc)
  if (!isLocked) return null

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        positionType: 'absolute',
        pointerFilter: 'none' // Crucial: lets clicks pass through to 3D objects
      }}
    >
      <UiEntity
        uiTransform={{
          width: 48,
          height: 48,
          pointerFilter: 'none'
        }}
        uiBackground={{
          textureMode: 'stretch',
          texture: {
            src: 'assets/images/crosshair.png'
          }
        }}
      />
    </UiEntity>
  )
}