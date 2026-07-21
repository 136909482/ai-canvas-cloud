import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('administrator bootstrap refuses non-interactive input and never accepts an environment password', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/bootstrap-admin.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ADMIN_BOOTSTRAP_PASSWORD: 'must-never-be-read' },
    encoding: 'utf8',
    input: 'admin@example.invalid\npassword-from-stdin\n',
    timeout: 10_000,
  })
  assert.notEqual(result.status, 0)
  const output = `${result.stdout}\n${result.stderr}`
  assert.match(output, /interactive TTY/)
  assert.doesNotMatch(output, /must-never-be-read|password-from-stdin/)
})
