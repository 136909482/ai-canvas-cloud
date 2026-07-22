import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readlinkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const RUNTIME_DIR = join(REPO_ROOT, '.codex-run')
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SERVICE_CHILD_PATH = join(dirname(SCRIPT_PATH), 'dev-service-child.mjs')
const STOP_TIMEOUT_MS = 15_000
const START_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 100

export const SERVICE_NAMES = ['web', 'api', 'admin-web', 'admin-api']
export const LEGACY_STOP_SERVICE_NAMES = ['worker']

function normalizePath(value) {
  const normalized = resolve(value).replaceAll('\\', '/').replace(/\/$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function runtimePath(service) {
  return join(RUNTIME_DIR, `${service}.json`)
}

function stopPath(service) {
  return join(RUNTIME_DIR, `${service}.stop.json`)
}

function logPath(service, stream) {
  return join(RUNTIME_DIR, `${service}.${stream}.log`)
}

function cwdProof(token, pid, cwd) {
  return createHash('sha256').update(`${token}\0${pid}\0${normalizePath(cwd)}`).digest('hex')
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function inspectWindowsProcess(pid) {
  const command = [
    `$item = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"`,
    'if ($null -eq $item) { exit 3 }',
    '$item | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
  ].join('; ')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0 || !result.stdout.trim()) return null
  const value = JSON.parse(result.stdout)
  return {
    pid: Number(value.ProcessId),
    executablePath: String(value.ExecutablePath ?? ''),
    commandLine: String(value.CommandLine ?? ''),
  }
}

function inspectProcProcess(pid) {
  try {
    return {
      pid,
      executablePath: readlinkSync(`/proc/${pid}/exe`),
      commandLine: readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' '),
    }
  } catch {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    if (result.status !== 0 || !result.stdout.trim()) return null
    return { pid, executablePath: '', commandLine: result.stdout.trim() }
  }
}

export function inspectProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !processExists(pid)) return null
  return process.platform === 'win32' ? inspectWindowsProcess(pid) : inspectProcProcess(pid)
}

export function validateManagedProcess(manifest, processInfo, service, repoRoot = REPO_ROOT) {
  if (!manifest || typeof manifest !== 'object' || !processInfo) {
    return { ok: false, reason: 'missing_process_identity' }
  }
  if (manifest.version !== 1 || manifest.service !== service || manifest.pid !== processInfo.pid) {
    return { ok: false, reason: 'pid_or_service_mismatch' }
  }
  if (typeof manifest.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(manifest.token)) {
    return { ok: false, reason: 'invalid_ownership_token' }
  }
  if (normalizePath(manifest.cwd ?? '') !== normalizePath(repoRoot)
    || normalizePath(manifest.scriptPath ?? '') !== normalizePath(SCRIPT_PATH)
    || manifest.cwdProof !== cwdProof(manifest.token, manifest.pid, manifest.cwd)) {
    return { ok: false, reason: 'working_directory_mismatch' }
  }

  const commandLine = processInfo.commandLine.replaceAll('\\', '/').toLowerCase()
  const expectedScript = normalizePath(SCRIPT_PATH).toLowerCase()
  if (!commandLine.includes(expectedScript)
    || !commandLine.includes(' run ')
    || !commandLine.includes(` ${service.toLowerCase()} `)
    || !commandLine.includes(manifest.token.toLowerCase())) {
    return { ok: false, reason: 'command_line_mismatch' }
  }
  if (processInfo.executablePath && basename(processInfo.executablePath).toLowerCase() !== basename(process.execPath).toLowerCase()) {
    return { ok: false, reason: 'executable_mismatch' }
  }
  return { ok: true }
}

function serviceCommand(service, token) {
  const title = `ai-canvas-cloud-${service}-${token}`
  if (service === 'web' || service === 'admin-web') {
    const isAdmin = service === 'admin-web'
    return {
      executable: process.execPath,
      args: [
        `--title=${title}`,
        join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
        join(REPO_ROOT, 'apps', service),
        '--host',
        (isAdmin ? process.env.ADMIN_WEB_HOST : process.env.WEB_HOST) ?? '127.0.0.1',
        '--port',
        (isAdmin ? process.env.ADMIN_WEB_PORT : process.env.WEB_PORT) ?? (isAdmin ? '5174' : '5173'),
        '--strictPort',
      ],
      ipc: false,
    }
  }
  return {
    executable: process.execPath,
    args: [
      `--title=${title}`,
      '--import',
      'tsx',
      SERVICE_CHILD_PATH,
      service,
    ],
    ipc: true,
  }
}

function removeOwnedFile(path, token) {
  const value = readJson(path)
  if (value?.token === token) rmSync(path, { force: true })
}

async function runService(service, token) {
  if (!SERVICE_NAMES.includes(service) || !/^[0-9a-f-]{36}$/i.test(token)) process.exit(2)
  mkdirSync(RUNTIME_DIR, { recursive: true })
  process.chdir(REPO_ROOT)
  rmSync(stopPath(service), { force: true })

  const command = serviceCommand(service, token)
  const child = spawn(command.executable, command.args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: command.ipc ? ['ignore', 'inherit', 'inherit', 'ipc'] : 'inherit',
    windowsHide: true,
  })
  const manifest = {
    version: 1,
    service,
    pid: process.pid,
    childPid: child.pid,
    token,
    cwd: process.cwd(),
    scriptPath: SCRIPT_PATH,
    cwdProof: cwdProof(token, process.pid, process.cwd()),
    startedAt: new Date().toISOString(),
  }
  writeJson(runtimePath(service), manifest)

  let stopping = false
  async function stopChild() {
    if (stopping) return
    stopping = true
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.send({ type: 'stop' })
      else child.kill('SIGTERM')
    }
    const deadline = Date.now() + 10_000
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(100)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }

  const stopPoll = setInterval(() => {
    const request = readJson(stopPath(service))
    if (request?.token === token) void stopChild()
  }, 250)
  stopPoll.unref()
  process.once('SIGINT', () => void stopChild())
  process.once('SIGTERM', () => void stopChild())

  const exitCode = await new Promise((resolvePromise) => {
    child.once('exit', (code) => resolvePromise(code ?? (stopping ? 0 : 1)))
    child.once('error', () => resolvePromise(1))
  })
  clearInterval(stopPoll)
  removeOwnedFile(runtimePath(service), token)
  removeOwnedFile(stopPath(service), token)
  process.exit(exitCode)
}

async function getManagedState(service, inspector = inspectProcess) {
  const manifest = readJson(runtimePath(service))
  if (!manifest) return { state: 'stopped', manifest: null }
  if (Number.isInteger(manifest.pid) && manifest.pid > 0 && !processExists(manifest.pid)) {
    return { state: 'stale', manifest }
  }
  const processInfo = inspector(manifest.pid)
  const validation = validateManagedProcess(manifest, processInfo, service)
  if (!validation.ok) return { state: 'unverified', manifest, reason: validation.reason }
  return { state: 'running', manifest }
}

async function startService(service) {
  const current = await getManagedState(service)
  if (current.state === 'running') {
    console.log(`${service}: already running (pid ${current.manifest.pid})`)
    return false
  }
  if (current.state === 'stale') {
    removeOwnedFile(runtimePath(service), current.manifest.token)
    removeOwnedFile(stopPath(service), current.manifest.token)
  }
  if (current.state === 'unverified') {
    throw new Error(`${service}: refusing to replace unverified PID record (${current.reason})`)
  }

  mkdirSync(RUNTIME_DIR, { recursive: true })
  const token = randomUUID()
  const stdout = openSync(logPath(service, 'stdout'), 'a')
  const stderr = openSync(logPath(service, 'stderr'), 'a')
  const runner = spawn(process.execPath, [SCRIPT_PATH, 'run', service, token], {
    cwd: REPO_ROOT,
    detached: true,
    env: process.env,
    stdio: ['ignore', stdout, stderr],
    windowsHide: true,
  })
  runner.unref()
  closeSync(stdout)
  closeSync(stderr)

  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const manifest = readJson(runtimePath(service))
    if (manifest?.token === token) {
      await sleep(1_000)
      const state = await getManagedState(service)
      if (state.state === 'running') {
        console.log(`${service}: started (pid ${state.manifest.pid})`)
        return true
      }
    }
    if (!processExists(runner.pid)) break
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`${service}: failed to start; inspect ${logPath(service, 'stderr')}`)
}

async function stopService(service) {
  const current = await getManagedState(service)
  if (current.state === 'stopped') {
    console.log(`${service}: already stopped`)
    return
  }
  if (current.state === 'stale') {
    removeOwnedFile(runtimePath(service), current.manifest.token)
    removeOwnedFile(stopPath(service), current.manifest.token)
    console.log(`${service}: removed stale record; process already stopped`)
    return
  }
  if (current.state !== 'running') {
    throw new Error(`${service}: refusing to stop unverified PID ${current.manifest?.pid ?? 'unknown'} (${current.reason})`)
  }

  writeJson(stopPath(service), { token: current.manifest.token })
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!processExists(current.manifest.pid)) {
      console.log(`${service}: stopped`)
      return
    }
    await sleep(POLL_INTERVAL_MS)
  }
  const processInfo = inspectProcess(current.manifest.pid)
  const validation = validateManagedProcess(current.manifest, processInfo, service)
  if (!validation.ok) throw new Error(`${service}: identity changed while stopping; refusing force stop`)
  process.kill(current.manifest.pid, 'SIGKILL')
  console.log(`${service}: force-stopped after graceful timeout`)
}

async function startAll() {
  const started = []
  try {
    for (const service of SERVICE_NAMES) {
      if (await startService(service)) started.push(service)
    }
  } catch (error) {
    for (const service of started.reverse()) {
      try { await stopService(service) } catch { /* Preserve the original start failure. */ }
    }
    throw error
  }
  console.log(`web: http://${process.env.WEB_HOST ?? '127.0.0.1'}:${process.env.WEB_PORT ?? '5173'}`)
  console.log(`api: http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? '8787'}`)
  console.log(`admin web: http://${process.env.ADMIN_WEB_HOST ?? '127.0.0.1'}:${process.env.ADMIN_WEB_PORT ?? '5174'}`)
  console.log(`admin api: http://${process.env.ADMIN_API_HOST ?? '127.0.0.1'}:${process.env.ADMIN_API_PORT ?? '8788'}`)
}

async function stopAll() {
  const failures = []
  for (const service of [...SERVICE_NAMES, ...LEGACY_STOP_SERVICE_NAMES].reverse()) {
    try { await stopService(service) } catch (error) { failures.push(error) }
  }
  if (failures.length > 0) throw failures[0]
}

async function statusAll() {
  let unhealthy = false
  for (const service of SERVICE_NAMES) {
    const state = await getManagedState(service)
    if (state.state === 'running') console.log(`${service}: running (pid ${state.manifest.pid})`)
    else if (state.state === 'stopped') console.log(`${service}: stopped`)
    else if (state.state === 'stale') console.log(`${service}: stopped (stale record)`)
    else {
      unhealthy = true
      console.log(`${service}: unverified (${state.reason})`)
    }
  }
  if (unhealthy) process.exitCode = 1
}

async function main() {
  const [action, service, token] = process.argv.slice(2)
  if (action === 'run') return runService(service, token)
  if (action === 'start') return startAll()
  if (action === 'stop') return stopAll()
  if (action === 'restart') {
    await stopAll()
    return startAll()
  }
  if (action === 'status') return statusAll()
  throw new Error('Usage: node scripts/dev-process.mjs <start|stop|restart|status>')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Development process command failed')
    process.exitCode = 1
  })
}
