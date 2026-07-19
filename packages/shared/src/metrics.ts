export type MetricLabels = Readonly<Record<string, string | number | boolean>>

export interface MetricsSnapshot {
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>
  gauges: Array<{ name: string; labels: Record<string, string>; value: number }>
  histograms: Array<{
    name: string
    labels: Record<string, string>
    buckets: Array<{ upperBound: number; count: number }>
    count: number
    sum: number
  }>
}

export interface MetricsRegistry {
  increment: (name: string, value?: number, labels?: MetricLabels) => void
  setGauge: (name: string, value: number, labels?: MetricLabels) => void
  observe: (name: string, value: number, labels?: MetricLabels) => void
  snapshot: () => MetricsSnapshot
  renderPrometheus: () => string
}

const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
// Labels are an operational contract: keep names and values bounded so IDs,
// URLs, email addresses, and request bodies cannot become high-cardinality data.
const ALLOWED_LABEL_NAMES = new Set([
  'bucket', 'code', 'component', 'dependency', 'method', 'operation', 'outcome',
  'phase', 'provider', 'reason', 'route', 'source', 'state', 'status_class', 'task_status',
])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i
const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]

type MetricType = 'counter' | 'gauge' | 'histogram'

interface MetricDefinition {
  name: string
  type: MetricType
  labels: string[]
}

interface MetricValue {
  definition: MetricDefinition
  labels: Record<string, string>
  key: string
  value: number
  buckets?: number[]
  count?: number
  sum?: number
}

function validateName(value: string, kind: string) {
  if (!METRIC_NAME_PATTERN.test(value)) {
    throw new Error(`Invalid ${kind} name`)
  }
  return value
}

function normalizeLabels(labels: MetricLabels | undefined) {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(labels ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (!LABEL_NAME_PATTERN.test(name)) {
      throw new Error('Invalid metric label name')
    }
    if (!ALLOWED_LABEL_NAMES.has(name)) {
      throw new Error(`Metric label is not allowlisted: ${name}`)
    }
    const normalized = String(value)
    if (normalized.length > 64 || /[@\r\n]/.test(normalized) || /^https?:\/\//i.test(normalized) || UUID_PATTERN.test(normalized)) {
      throw new Error(`Metric label value is not low-cardinality: ${name}`)
    }
    output[name] = normalized
  }
  return output
}

function labelsKey(labels: Record<string, string>) {
  return JSON.stringify(labels)
}

function finiteValue(value: number, field: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be finite`)
  }
  return value
}

function escapeLabelValue(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

function renderLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels)
  return entries.length === 0
    ? ''
    : `{${entries.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)))
}

export function createMetricsRegistry(options: {
  prefix?: string
  histogramBuckets?: readonly number[]
} = {}): MetricsRegistry {
  const prefix = options.prefix ?? 'ai_canvas_'
  if (prefix && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix)) {
    throw new Error('Invalid metrics prefix')
  }
  const buckets = [...(options.histogramBuckets ?? DEFAULT_HISTOGRAM_BUCKETS)]
  if (buckets.length === 0 || buckets.some((value) => !Number.isFinite(value) || value <= 0)
    || buckets.some((value, index) => index > 0 && value <= buckets[index - 1]!)) {
    throw new Error('Histogram buckets must be finite, positive, and strictly increasing')
  }

  const definitions = new Map<string, MetricDefinition>()
  const values = new Map<string, MetricValue>()

  function resolveName(name: string) {
    return validateName(name.startsWith(prefix) ? name : `${prefix}${name}`, 'metric')
  }

  function getValue(name: string, type: MetricType, labelsInput?: MetricLabels) {
    const resolvedName = resolveName(name)
    const labels = normalizeLabels(labelsInput)
    const existing = definitions.get(resolvedName)
    if (existing && (existing.type !== type || existing.labels.join('\u0000') !== Object.keys(labels).join('\u0000'))) {
      throw new Error(`Metric ${resolvedName} was registered with an incompatible shape`)
    }
    if (!existing) {
      definitions.set(resolvedName, { name: resolvedName, type, labels: Object.keys(labels) })
    }
    const key = `${resolvedName}\u0000${labelsKey(labels)}`
    const current = values.get(key)
    if (current) return current
    const created: MetricValue = {
      definition: definitions.get(resolvedName)!,
      labels,
      key,
      value: 0,
      ...(type === 'histogram' ? { buckets: buckets.map(() => 0), count: 0, sum: 0 } : {}),
    }
    values.set(key, created)
    return created
  }

  return {
    increment(name, value = 1, labels) {
      const metric = getValue(name, 'counter', labels)
      metric.value += finiteValue(value, 'Metric counter value')
    },
    setGauge(name, value, labels) {
      const metric = getValue(name, 'gauge', labels)
      metric.value = finiteValue(value, 'Metric gauge value')
    },
    observe(name, value, labels) {
      const metric = getValue(name, 'histogram', labels)
      const normalized = finiteValue(value, 'Metric observation')
      metric.count = (metric.count ?? 0) + 1
      metric.sum = (metric.sum ?? 0) + normalized
      metric.buckets?.forEach((_, index) => {
        if (normalized <= buckets[index]!) metric.buckets![index] = metric.buckets![index]! + 1
      })
    },
    snapshot() {
      const all = [...values.values()]
      return {
        counters: all.filter((item) => item.definition.type === 'counter').map((item) => ({
          name: item.definition.name, labels: { ...item.labels }, value: item.value,
        })),
        gauges: all.filter((item) => item.definition.type === 'gauge').map((item) => ({
          name: item.definition.name, labels: { ...item.labels }, value: item.value,
        })),
        histograms: all.filter((item) => item.definition.type === 'histogram').map((item) => ({
          name: item.definition.name,
          labels: { ...item.labels },
          buckets: buckets.map((upperBound, index) => ({ upperBound, count: item.buckets![index]! })),
          count: item.count ?? 0,
          sum: item.sum ?? 0,
        })),
      }
    },
    renderPrometheus() {
      const lines: string[] = []
      for (const definition of definitions.values()) {
        lines.push(`# TYPE ${definition.name} ${definition.type}`)
        const metricValues = [...values.values()].filter((item) => item.definition.name === definition.name)
        if (definition.type === 'histogram') {
          for (const item of metricValues) {
            const baseLabels = item.labels
            item.buckets?.forEach((count, index) => {
              lines.push(`${definition.name}_bucket${renderLabels({ ...baseLabels, le: String(buckets[index]) })} ${count}`)
            })
            lines.push(`${definition.name}_bucket${renderLabels({ ...baseLabels, le: '+Inf' })} ${item.count ?? 0}`)
            lines.push(`${definition.name}_sum${renderLabels(baseLabels)} ${formatNumber(item.sum ?? 0)}`)
            lines.push(`${definition.name}_count${renderLabels(baseLabels)} ${item.count ?? 0}`)
          }
        } else {
          for (const item of metricValues) {
            lines.push(`${definition.name}${renderLabels(item.labels)} ${formatNumber(item.value)}`)
          }
        }
      }
      return lines.length > 0 ? `${lines.join('\n')}\n` : ''
    },
  }
}
