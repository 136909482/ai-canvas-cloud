import assert from 'node:assert/strict'
import test from 'node:test'
import { createMetricsRegistry } from './metrics.ts'

test('metrics registry renders stable counters, gauges, and histograms without sensitive labels', () => {
  const metrics = createMetricsRegistry({ histogramBuckets: [0.1, 1] })
  metrics.increment('task_retries_total', 2, { outcome: 'requeued' })
  metrics.setGauge('task_queue_backlog', 3)
  metrics.observe('provider_request_duration_seconds', 0.25, { provider: 'openai', operation: 'generate', outcome: 'success' })

  assert.match(metrics.renderPrometheus(), /ai_canvas_task_retries_total\{outcome="requeued"\} 2/)
  assert.match(metrics.renderPrometheus(), /ai_canvas_task_queue_backlog 3/)
  assert.match(metrics.renderPrometheus(), /ai_canvas_provider_request_duration_seconds_bucket\{operation="generate",outcome="success",provider="openai",le="1"\} 1/)
  assert.equal(metrics.snapshot().histograms[0]?.count, 1)
})

test('metrics registry rejects incompatible shapes and invalid values', () => {
  const metrics = createMetricsRegistry()
  metrics.increment('task_retries_total')
  assert.throws(() => metrics.setGauge('task_retries_total', 1), /incompatible shape/)
  assert.throws(() => metrics.observe('provider_latency_seconds', Number.NaN), /finite/)
  assert.throws(() => metrics.increment('bad metric name'), /metric name/)
})

test('metrics registry rejects sensitive and high-cardinality label data', () => {
  const metrics = createMetricsRegistry()
  assert.throws(() => metrics.increment('requests_total', 1, { user_id: 'user-1' }), /allowlisted/)
  assert.throws(() => metrics.increment('requests_total', 1, { route: 'https://example.test/private' }), /low-cardinality/)
  assert.throws(() => metrics.increment('requests_total', 1, { route: '11111111-1111-4111-8111-111111111111' }), /low-cardinality/)
  assert.throws(() => metrics.increment('requests_total', 1, { route: 'a'.repeat(65) }), /low-cardinality/)
})
