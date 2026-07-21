import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT, SERVICE_NAMES, validateManagedProcess } from './dev-process.mjs'

const scriptPath = fileURLToPath(new URL('./dev-process.mjs', import.meta.url))

function manifest(overrides = {}) {
  const token = overrides.token ?? randomUUID()
  const pid = overrides.pid ?? 1234
  const cwd = overrides.cwd ?? REPO_ROOT
  const normalized = resolve(cwd).replaceAll('\\', '/').replace(/\/$/, '')
  const proofCwd = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  return {
    version: 1,
    service: 'api',
    pid,
    childPid: 4321,
    token,
    cwd,
    scriptPath,
    cwdProof: createHash('sha256').update(`${token}\0${pid}\0${proofCwd}`).digest('hex'),
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

function processInfo(value) {
  return {
    pid: value.pid,
    executablePath: process.execPath,
    commandLine: `\"${process.execPath}\" \"${scriptPath}\" run api ${value.token}`,
  }
}

test('managed process identity requires PID, repository cwd, command line, and ownership token', () => {
  const value = manifest()
  assert.deepEqual(validateManagedProcess(value, processInfo(value), 'api'), { ok: true })
})

test('managed services include both isolated Admin applications', () => {
  assert.deepEqual(SERVICE_NAMES, ['web', 'api', 'worker', 'admin-web', 'admin-api'])
})

test('managed process identity rejects a different working directory or command line', () => {
  const wrongCwd = manifest({ cwd: join(REPO_ROOT, 'apps') })
  assert.equal(validateManagedProcess(wrongCwd, processInfo(wrongCwd), 'api').reason, 'working_directory_mismatch')

  const value = manifest()
  assert.equal(validateManagedProcess(value, {
    ...processInfo(value),
    commandLine: `\"${process.execPath}\" unrelated-script.mjs run api ${value.token}`,
  }, 'api').reason, 'command_line_mismatch')
})

test('managed process identity rejects PID reuse and another service token', () => {
  const value = manifest()
  assert.equal(validateManagedProcess(value, { ...processInfo(value), pid: value.pid + 1 }, 'api').reason, 'pid_or_service_mismatch')
  assert.equal(validateManagedProcess(value, {
    ...processInfo(value),
    commandLine: `\"${process.execPath}\" \"${scriptPath}\" run api ${randomUUID()}`,
  }, 'api').reason, 'command_line_mismatch')
})
