import { cloudPlatformBridge } from '@/platform/cloud/cloudPlatform'
import type { PlatformRuntimeKind } from '@/platform/types'

export const platformRuntime: PlatformRuntimeKind = 'cloud'
export const platformBridge = cloudPlatformBridge

export function isElectronRuntime() {
  return false
}
