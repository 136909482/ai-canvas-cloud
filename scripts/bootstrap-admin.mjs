import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { bootstrapFirstSuperAdmin, createPostgresPool, loadDotEnv } from '@ai-canvas-cloud/server'
import { loadAdminApiConfig } from '../apps/admin-api/src/config.ts'

function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Administrator bootstrap requires an interactive TTY')
  }
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup(); reject(new Error('Administrator bootstrap canceled')); return
        }
        if (character === '\r' || character === '\n') {
          cleanup(); process.stdout.write('\n'); resolve(value); return
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length > 0) { value = value.slice(0, -1); process.stdout.write('\b \b') }
          continue
        }
        if (character >= ' ') { value += character; process.stdout.write('*') }
      }
    }
    function cleanup() {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    process.stdin.on('data', onData)
  })
}

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Administrator bootstrap requires an interactive TTY')
loadDotEnv()
const config = loadAdminApiConfig()
const prompt = createInterface({ input: process.stdin, output: process.stdout })
const username = (await prompt.question('首个 super_admin 账号: ')).trim()
prompt.close()
const password = await readSecret('密码（至少 12 位）: ')
const confirmation = await readSecret('再次输入密码: ')
if (password !== confirmation) throw new Error('两次密码输入不一致')
const pool = createPostgresPool({ connectionString: config.databaseUrl, schema: 'admin' })
try {
  await bootstrapFirstSuperAdmin(pool, {
    baseURL: config.betterAuthUrl,
    secret: config.betterAuthSecret,
    trustedOrigins: config.allowedOrigins,
    environment: config.env,
  }, { username, password, requestId: `bootstrap-${randomUUID()}` })
  console.log('首个 super_admin 已创建；可使用管理员账号和密码登录。')
} finally {
  await pool.end()
}
