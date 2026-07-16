import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SESSION_HEARTBEAT_INTERVAL_MS,
  shouldProbeSession,
} from './sessionProbe.ts'

test('session heartbeat probes wait for the full five-minute interval', () => {
  assert.equal(shouldProbeSession({
    now: SESSION_HEARTBEAT_INTERVAL_MS - 1,
    lastProbeAt: 0,
    inFlight: false,
  }), false)
  assert.equal(shouldProbeSession({
    now: SESSION_HEARTBEAT_INTERVAL_MS,
    lastProbeAt: 0,
    inFlight: false,
  }), true)
})

test('session heartbeat probes remain single-flight', () => {
  assert.equal(shouldProbeSession({
    now: SESSION_HEARTBEAT_INTERVAL_MS * 2,
    lastProbeAt: 0,
    inFlight: true,
  }), false)
})
