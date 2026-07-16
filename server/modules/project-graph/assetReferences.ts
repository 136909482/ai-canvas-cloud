import type {
  AssetReferenceRole,
  ProjectGraphNode,
  ProjectGraphOperation,
} from '@ai-canvas-cloud/contracts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLOUD_ASSET_PREFIX = 'cloud-assets/'

export interface NodeAssetReference {
  assetId: string
  referenceRole: AssetReferenceRole
}

export interface NodeAssetReferenceChange {
  nodeId: string
  references: NodeAssetReference[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeAssetId(value: unknown) {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('Node assetId must be a valid UUID')
  }

  return value.toLowerCase()
}

function parseCloudAssetLocator(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.toLowerCase().startsWith(CLOUD_ASSET_PREFIX)) {
    return null
  }

  const assetId = value.slice(CLOUD_ASSET_PREFIX.length)
  if (!UUID_PATTERN.test(assetId)) {
    throw new Error(`Node ${field} must contain a valid Cloud asset locator`)
  }

  return assetId.toLowerCase()
}

function getPrimaryReferenceRole(
  nodeType: string,
  value: Record<string, unknown>,
  path: readonly string[],
): AssetReferenceRole {
  const normalizedPath = path.join('.').toLowerCase()
  if (normalizedPath.includes('mask')) {
    return 'mask'
  }

  if (value.assetKind === 'thumbnail') {
    return 'thumbnail'
  }
  if (value.assetKind === 'preview') {
    return 'preview'
  }
  if (value.assetKind === 'generated' || value.assetKind === 'edit' || value.assetKind === 'crop') {
    return 'result'
  }
  if (nodeType === 'generatedPreviewNode') {
    return 'result'
  }

  return 'source'
}

export function extractNodeAssetReferences(
  node: Pick<ProjectGraphNode, 'nodeType' | 'data'>,
): NodeAssetReference[] {
  const references = new Map<string, NodeAssetReference>()
  const visited = new Set<object>()
  const pending: Array<{ value: unknown; path: readonly string[] }> = [{ value: node.data, path: [] }]

  const addReference = (assetId: string, referenceRole: AssetReferenceRole) => {
    references.set(`${assetId}:${referenceRole}`, { assetId, referenceRole })
  }

  while (pending.length > 0) {
    const { value, path } = pending.pop()!
    if (Array.isArray(value)) {
      if (visited.has(value)) {
        continue
      }
      visited.add(value)
      value.forEach((entry, index) => pending.push({ value: entry, path: [...path, String(index)] }))
      continue
    }
    if (!isRecord(value) || visited.has(value)) {
      continue
    }
    visited.add(value)

    const explicitAssetId = normalizeAssetId(value.assetId)
    const relativePathAssetId = parseCloudAssetLocator(value.relativePath, 'relativePath')
    if (explicitAssetId && relativePathAssetId && explicitAssetId !== relativePathAssetId) {
      throw new Error('Node assetId and relativePath refer to different Cloud assets')
    }

    const primaryAssetId = explicitAssetId ?? relativePathAssetId
    if (primaryAssetId) {
      addReference(primaryAssetId, getPrimaryReferenceRole(node.nodeType, value, path))
    }

    const thumbnailAssetId = parseCloudAssetLocator(value.thumbnailRelativePath, 'thumbnailRelativePath')
    if (thumbnailAssetId) {
      addReference(thumbnailAssetId, 'thumbnail')
    }

    const previewAssetId = parseCloudAssetLocator(value.previewRelativePath, 'previewRelativePath')
    if (previewAssetId) {
      addReference(previewAssetId, 'preview')
    }

    for (const [key, entry] of Object.entries(value)) {
      if (key === 'assetId' || key === 'relativePath' || key === 'thumbnailRelativePath' || key === 'previewRelativePath') {
        continue
      }
      pending.push({ value: entry, path: [...path, key] })
    }
  }

  return [...references.values()].sort((left, right) =>
    left.referenceRole.localeCompare(right.referenceRole) || left.assetId.localeCompare(right.assetId),
  )
}

export function collectNodeAssetReferenceChanges(
  operations: ProjectGraphOperation[],
): NodeAssetReferenceChange[] {
  return operations.flatMap((operation) => {
    if (operation.type === 'upsertNode') {
      return [{
        nodeId: operation.node.id,
        references: extractNodeAssetReferences(operation.node),
      }]
    }
    if (operation.type === 'deleteNode') {
      return [{ nodeId: operation.nodeId, references: [] }]
    }

    return []
  })
}

export function collectNodeAssetReferenceChangesForNodes(
  nodes: ProjectGraphNode[],
): NodeAssetReferenceChange[] {
  return nodes.map((node) => ({
    nodeId: node.id,
    references: extractNodeAssetReferences(node),
  }))
}

export function collectAssetIdsFromNodeReferenceChanges(
  changes: NodeAssetReferenceChange[],
) {
  return [...new Set(changes.flatMap((change) =>
    change.references.map((reference) => reference.assetId),
  ))].sort()
}

export function normalizeAssetManifest(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Checkpoint asset manifest must be an array')
  }

  const assetIds = value.map((assetId) => {
    if (typeof assetId !== 'string' || !UUID_PATTERN.test(assetId)) {
      throw new Error('Checkpoint asset manifest must contain valid asset UUIDs')
    }
    return assetId.toLowerCase()
  })

  return [...new Set(assetIds)].sort()
}
