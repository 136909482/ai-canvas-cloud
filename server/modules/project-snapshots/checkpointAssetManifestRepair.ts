import type { ProjectGraphNode } from '@ai-canvas-cloud/contracts'
import {
  collectAssetIdsFromNodeReferenceChanges,
  collectNodeAssetReferenceChangesForNodes,
  normalizeAssetManifest,
} from '../project-graph/assetReferences.js'
import {
  validateProjectGraphEdge,
  validateProjectGraphNode,
} from '../project-graph/service.js'
import { PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION } from './service.js'

export type RepairableManifestReason = 'empty' | 'mismatch' | 'noncanonical'
export type InvalidCheckpointReason = 'record_invalid' | 'manifest_invalid'

export type CheckpointAssetManifestAssessment =
  | { status: 'consistent'; manifest: string[] }
  | { status: 'repairable'; manifest: string[]; reason: RepairableManifestReason }
  | { status: 'invalid'; reason: InvalidCheckpointReason }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function deriveCheckpointAssetManifest(record: unknown, projectId: string) {
  if (
    !isRecord(record)
    || record.schemaVersion !== PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION
    || !isRecord(record.project)
    || record.project.id !== projectId
    || !isRecord(record.canvas)
    || !Array.isArray(record.canvas.nodes)
    || !Array.isArray(record.canvas.edges)
  ) {
    throw new Error('Checkpoint record is not restorable')
  }

  const nodes: ProjectGraphNode[] = record.canvas.nodes.map(validateProjectGraphNode)
  record.canvas.edges.forEach((edge) => {
    validateProjectGraphEdge(edge)
  })

  return collectAssetIdsFromNodeReferenceChanges(
    collectNodeAssetReferenceChangesForNodes(nodes),
  )
}

export function assessCheckpointAssetManifest(input: {
  projectId: string
  record: unknown
  storedManifest: unknown
}): CheckpointAssetManifestAssessment {
  let derivedManifest: string[]
  try {
    derivedManifest = deriveCheckpointAssetManifest(input.record, input.projectId)
  } catch {
    return { status: 'invalid', reason: 'record_invalid' }
  }

  let normalizedStoredManifest: string[]
  try {
    normalizedStoredManifest = normalizeAssetManifest(input.storedManifest)
  } catch {
    return { status: 'invalid', reason: 'manifest_invalid' }
  }

  const storedManifest = input.storedManifest as unknown[]
  const canonical = arraysEqual(storedManifest, normalizedStoredManifest)
  if (canonical && arraysEqual(normalizedStoredManifest, derivedManifest)) {
    return { status: 'consistent', manifest: derivedManifest }
  }

  const reason: RepairableManifestReason = normalizedStoredManifest.length === 0 && derivedManifest.length > 0
    ? 'empty'
    : arraysEqual(normalizedStoredManifest, derivedManifest)
      ? 'noncanonical'
      : 'mismatch'

  return { status: 'repairable', manifest: derivedManifest, reason }
}
