export const LOCAL_MODEL_REFERENCE_PREFIX = 'local:'

const LOCAL_MODEL_REFERENCE_PATTERN = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isLocalModelReference(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_MODEL_REFERENCE_PATTERN.test(value)
}

export function normalizeLocalModelBindings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => (
        isLocalModelReference(entry[0])
        && typeof entry[1] === 'string'
        && entry[1].trim().length > 0
      ))
      .map(([reference, modelId]) => [reference, modelId.trim()]),
  )
}

export function resolveLocalModelReference(bindings: Record<string, string>, reference: string) {
  if (!isLocalModelReference(reference)) return reference
  return bindings[reference]?.trim() || null
}

export function findLocalModelReference(bindings: Record<string, string>, modelId: string) {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) return null

  return Object.entries(bindings).find(([, boundModelId]) => boundModelId === normalizedModelId)?.[0] ?? null
}

export function createLocalModelReference(existingReferences: Iterable<string> = []) {
  const existing = new Set(existingReferences)

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const reference = `${LOCAL_MODEL_REFERENCE_PREFIX}${crypto.randomUUID()}`
    if (!existing.has(reference)) return reference
  }

  throw new Error('无法创建唯一的本地模型引用')
}
