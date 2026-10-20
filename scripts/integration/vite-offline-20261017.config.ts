// Offline OPERATIONAL Vite config (2026-10-17) for guarded local capture/build runs.
// This is NOT the deploy config: it loads ./vite.config.ts and then removes the dev
// `/api` → https://cocotripkr.com proxy, disables .env loading, pins a numeric loopback
// host/port and injects synthetic public Firebase placeholders. See CAPTURE-20261017.md.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Connect, Plugin, UserConfig } from 'vite'
import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOST = '127.0.0.1'
// Never created: points Vite's env loader at a directory with no .env files (second layer to envFile:false).
const NO_ENV_DIR = path.join(REPO_ROOT, 'scripts', 'integration', '.no-env-20261017')
const OUT_DIR = 'dist-offline-20261017'
// Same shape as tests/charter-local-server.mjs: without a key, firebase/auth throws auth/invalid-api-key at import.
const SYNTHETIC_FIREBASE: Record<string, string> = {
  VITE_FIREBASE_API_KEY: 'offline-synthetic-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'offline-synthetic.invalid',
  VITE_FIREBASE_PROJECT_ID: 'offline-synthetic-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'offline-synthetic.invalid',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:offline-synthetic',
}
// The original dev proxy bypass: src/ imports api/_shared/*.js as source modules.
const SHARED_SOURCE = /^\/api\/_shared\/[^?]+\.js(\?|$)/
// Vite 7.3.6 dev client. hmr:false is not enough: config.js 27491-92 treats it like default client
// options, and client.mjs 823 still opens the dev WebSocket. Only that one call is removed (dev only).
const VITE_CLIENT_FILE = path.join(REPO_ROOT, 'node_modules', 'vite', 'dist', 'client', 'client.mjs')
const VITE_CLIENT_SHA256 = 'ADC8D1D9BAB80984E8F7136074AF8EE8E6F63BCF8EE75D8950577E4BD73AF23A'
// Same form as Vite's normalizedClientEntry (normalizePath(CLIENT_ENTRY)): forward slashes, posix-normalized.
const VITE_CLIENT_ID = path.posix.normalize(VITE_CLIENT_FILE.replace(/\\/g, '/'))
const HMR_CONNECT_CALL = 'transport.connect(createHMRHandler(handleMessage));'
const HMR_CONNECT_OFFLINE = '/* offline-20261017: Vite dev HMR transport.connect removed; no dev WebSocket is opened. */'

function requirePort(): number {
  const raw = process.env.COCOTRIP_OFFLINE_PORT || ''
  if (!/^\d{4,5}$/.test(raw)) throw new Error('COCOTRIP_OFFLINE_PORT must be a numeric port (1024-65535)')
  const port = Number(raw)
  if (port < 1024 || port > 65535) throw new Error('COCOTRIP_OFFLINE_PORT must be 1024-65535')
  return port
}

const isEmpty = (value: unknown) => !value || (typeof value === 'object' && Object.keys(value as object).length === 0)

/**
 * envFile must be false. Vite 7.3.x then resolves envDir to `false` (observed in the 7.3.6 source
 * by review; not re-inspected here because this worktree has no node_modules). `false` is accepted
 * only together with envFile === false. Any other Vite that keeps a string envDir must resolve to
 * NO_ENV_DIR, and that directory must not exist or hold any .env* file.
 */
function envProblems(resolved: unknown): string[] {
  const problems: string[] = []
  const r = resolved as { envFile?: unknown; envDir?: unknown }
  const envFileOff = r.envFile === false
  if (!envFileOff) problems.push('envFile is not false')
  if (r.envDir === false) {
    if (!envFileOff) problems.push('envDir is false but envFile is not false')
  } else if (typeof r.envDir === 'string' && path.resolve(r.envDir) === path.resolve(NO_ENV_DIR)) {
    // Resolved envDir is normalized to forward slashes on Windows; compare resolved paths.
    if (fs.existsSync(NO_ENV_DIR)) {
      const envFiles = fs.readdirSync(NO_ENV_DIR).filter((name) => name.startsWith('.env'))
      problems.push(envFiles.length ? `offline envDir holds ${envFiles.join(', ')}` : 'offline envDir exists (must not be created)')
    }
  } else {
    problems.push('envDir is neither false (with envFile false) nor the empty offline directory')
  }
  return problems
}

/** Second layer behind the browser routing: the local server itself never answers /api/* with data. */
function blockApi(allowSharedSource: boolean): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url || ''
    if (!url.startsWith('/api/')) return next()
    if (allowSharedSource && SHARED_SOURCE.test(url)) return next()
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ error: 'OFFLINE_LOCAL_API_BLOCKED' }))
  }
}

function offlineGuard(port: number): Plugin {
  return {
    name: 'cocotrip-offline-20261017-guard',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(blockApi(true))
    },
    configurePreviewServer(server) {
      server.middlewares.use(blockApi(false))
    },
    configResolved(resolved) {
      const problems: string[] = []
      if (!isEmpty(resolved.server.proxy)) problems.push('server.proxy is still set')
      if (!isEmpty(resolved.preview.proxy)) problems.push('preview.proxy is still set')
      problems.push(...envProblems(resolved))
      // Key names only — values are never printed.
      const prefixes = ([] as string[]).concat(resolved.envPrefix || 'VITE_')
      const loaded = Object.keys(resolved.env).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      if (loaded.length) problems.push(`env keys loaded from files/process env: ${loaded.join(', ')}`)
      for (const [label, s] of [['server', resolved.server], ['preview', resolved.preview]] as const) {
        if (s.host !== HOST) problems.push(`${label}.host is not ${HOST}`)
        if (s.port !== port) problems.push(`${label}.port is not ${port}`)
        if (s.strictPort !== true) problems.push(`${label}.strictPort is not true`)
        if (s.open) problems.push(`${label}.open is set`)
      }
      if (resolved.server.hmr !== false) problems.push('server.hmr is not false')
      if (process.env.PRERENDER !== '0' || resolved.define.__PRERENDER_BUILD__ !== 'false') problems.push('prerender is not disabled')
      if (problems.length) throw new Error(`[offline-config] refusing to start: ${problems.join('; ')}`)
    },
  }
}

function viteClientSha256(): string {
  return createHash('sha256').update(fs.readFileSync(VITE_CLIENT_FILE)).digest('hex').toUpperCase()
}

/**
 * Serve only. Removes the single dev HMR `transport.connect(...)` call from the pinned Vite client and
 * leaves everything else (updateStyle/removeStyle, CSS imports, exports) intact. node_modules is not
 * written. enforce:'post' runs BEFORE vite:client-inject (Vite 7.3.6 config.js 28508 postPlugins precede
 * clientInjectionsPlugin at 28511); the target call holds no injected constant, so the replacement survives it.
 * The rest of the client stays fail-closed: any transport.send/invoke now throws "called before connect".
 */
function offlineViteClient(): Plugin {
  let replacements = 0
  return {
    name: 'cocotrip-offline-20261017-vite-client',
    apply: 'serve',
    enforce: 'post',
    configResolved() {
      const actual = viteClientSha256()
      if (actual !== VITE_CLIENT_SHA256) {
        throw new Error(`[offline-config] refusing to start: ${VITE_CLIENT_FILE} sha256 ${actual} is not the pinned ${VITE_CLIENT_SHA256}`)
      }
    },
    transform(code, id) {
      if (id !== VITE_CLIENT_ID) {
        // Any other id format for the same file (query, backslashes, case) is unexpected: refuse, don't skip.
        const bare = id.split('?')[0].replace(/\\/g, '/').toLowerCase()
        if (bare === VITE_CLIENT_ID.toLowerCase()) throw new Error(`[offline-config] unexpected Vite client id format: ${id}`)
        return null
      }
      const count = code.split(HMR_CONNECT_CALL).length - 1
      if (count !== 1) throw new Error(`[offline-config] Vite client: expected exactly 1 "${HMR_CONNECT_CALL}", found ${count}`)
      // Bytes on disk must still be the pinned file at load time, not only at startup.
      if (viteClientSha256() !== VITE_CLIENT_SHA256) throw new Error(`[offline-config] ${VITE_CLIENT_FILE} changed after startup`)
      replacements += 1
      console.info(`[offline-config] Vite client: dev HMR transport.connect removed (transform ${replacements})`)
      return { code: code.replace(HMR_CONNECT_CALL, () => HMR_CONNECT_OFFLINE), map: null }
    },
  }
}

export default defineConfig(async (env) => {
  // Must be set before the base config module is evaluated (it reads PRERENDER at top level).
  process.env.PRERENDER = '0'
  const port = requirePort()
  const loaded = await loadConfigFromFile(env, path.join(REPO_ROOT, 'vite.config.ts'), REPO_ROOT)
  if (!loaded) throw new Error('[offline-config] base vite.config.ts not found')

  const define: Record<string, string> = {}
  for (const [key, value] of Object.entries(SYNTHETIC_FIREBASE)) define[`import.meta.env.${key}`] = JSON.stringify(value)

  const overrides: UserConfig = {
    root: REPO_ROOT,
    envDir: NO_ENV_DIR,
    define,
    server: { host: HOST, port, strictPort: true, open: false, hmr: false },
    preview: { host: HOST, port, strictPort: true, open: false },
    build: { outDir: OUT_DIR, emptyOutDir: true },
    plugins: [offlineGuard(port), offlineViteClient()],
  }
  const merged = mergeConfig(loaded.config, overrides) as UserConfig & { envFile?: boolean }
  // mergeConfig deep-merges, so the base `/api` → prod proxy survives it; remove explicitly.
  if (merged.server) delete merged.server.proxy
  if (merged.preview) delete merged.preview.proxy
  merged.envFile = false
  return merged
})
