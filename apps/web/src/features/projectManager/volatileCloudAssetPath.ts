export function isVolatileCloudMemoryAssetPath(relativePath: string) {
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return normalizedPath === 'cloud-memory' || normalizedPath.startsWith('cloud-memory/')
}
