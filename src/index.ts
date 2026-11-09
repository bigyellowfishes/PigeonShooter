import {} from '@dcl/sdk/math'
import {} from '@dcl/sdk/ecs'
import { setupUi } from './ui'
import { SetUpShooting } from './shooting'
import { SetUpTargetSystem } from './targets';

export function main() {
    // Set Up Functions
    setupUi()
    SetUpTargetSystem()
    SetUpShooting()
}