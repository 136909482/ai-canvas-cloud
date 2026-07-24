import assert from "node:assert/strict";
import test from "node:test";
import { createMetricsRegistry } from "./metrics.ts";

test("metrics registry renders stable counters, gauges, and histograms without sensitive labels", () => {
  const metrics = createMetricsRegistry({ histogramBuckets: [0.1, 1] });
  metrics.increment("api_requests_total", 2, { outcome: "success" });
  metrics.setGauge("dependency_up", 1);
  metrics.observe("api_request_duration_seconds", 0.25, {
    operation: "read",
    outcome: "success",
  });

  assert.match(
    metrics.renderPrometheus(),
    /ai_canvas_api_requests_total\{outcome="success"\} 2/,
  );
  assert.match(metrics.renderPrometheus(), /ai_canvas_dependency_up 1/);
  assert.match(
    metrics.renderPrometheus(),
    /ai_canvas_api_request_duration_seconds_bucket\{operation="read",outcome="success",le="1"\} 1/,
  );
  assert.equal(metrics.snapshot().histograms[0]?.count, 1);
});

test("metrics registry rejects incompatible shapes and invalid values", () => {
  const metrics = createMetricsRegistry();
  metrics.increment("api_requests_total");
  assert.throws(
    () => metrics.setGauge("api_requests_total", 1),
    /incompatible shape/,
  );
  assert.throws(
    () => metrics.observe("api_latency_seconds", Number.NaN),
    /finite/,
  );
  assert.throws(() => metrics.increment("bad metric name"), /metric name/);
});

test("metrics registry rejects sensitive and high-cardinality label data", () => {
  const metrics = createMetricsRegistry();
  assert.throws(
    () => metrics.increment("requests_total", 1, { user_id: "user-1" }),
    /allowlisted/,
  );
  assert.throws(
    () =>
      metrics.increment("requests_total", 1, {
        route: "https://example.test/private",
      }),
    /low-cardinality/,
  );
  assert.throws(
    () =>
      metrics.increment("requests_total", 1, {
        route: "11111111-1111-4111-8111-111111111111",
      }),
    /low-cardinality/,
  );
  assert.throws(
    () => metrics.increment("requests_total", 1, { route: "a".repeat(65) }),
    /low-cardinality/,
  );
});
