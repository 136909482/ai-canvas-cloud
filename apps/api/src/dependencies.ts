import type { HealthDependencyStatus } from '@ai-canvas-cloud/contracts'
import { measureDependencyCheck } from '@ai-canvas-cloud/shared'

export interface ReadinessDependencyChecks {
  postgres?: () => Promise<void>
  objectStorage?: () => Promise<void>
  redis?: () => Promise<void>
}

async function unavailableCheck() {
  throw new Error('Dependency check is not configured')
}

export async function checkReadinessDependencies(
  checks: ReadinessDependencyChecks = {},
): Promise<Record<'postgres' | 'redis' | 'objectStorage', HealthDependencyStatus>> {
  const [postgres, redis, objectStorage] = await Promise.all([
    measureDependencyCheck(checks.postgres ?? unavailableCheck),
    measureDependencyCheck(checks.redis ?? unavailableCheck),
    measureDependencyCheck(checks.objectStorage ?? unavailableCheck),
  ])

  return { postgres, redis, objectStorage }
}
