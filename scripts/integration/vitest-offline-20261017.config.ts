// Offline OPERATIONAL Vitest config (2026-10-17) for guarded runs.
// Keeps every meaningful setting of ./vitest.config.ts (include, setupFiles, timeouts,
// coverage, aliases) and only adds: no .env loading, forks pool capped at 2 workers,
// isolation on, no watch, and server.host 127.0.0.1 (hmr/open off) so Vite's resolveHostname
// never does its `localhost` DNS lookup (vite config.js 2343/2355). Nothing listens: Vitest runs
// the server in middleware mode. No stubs, no skips — domain mocks stay each test's own job
// (tests/unit/setup.ts only registers jest-dom). See CAPTURE-20261017.md.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// Never created: Vite's env loader finds no .env files here (second layer to envFile:false).
const NO_ENV_DIR = path.join(REPO_ROOT, 'scripts', 'integration', '.no-env-20261017')

// Same rule as vite-offline-20261017.config.ts: envDir `false` (Vite 7.3.x with envFile:false) is
// accepted only together with envFile === false; a string envDir must be NO_ENV_DIR, absent, no .env*.
function envProblems(resolved: unknown): string[] {
  const problems: string[] = []
  const r = resolved as { envFile?: unknown; envDir?: unknown }
  const envFileOff = r.envFile === false
  if (!envFileOff) problems.push('envFile is not false')
  if (r.envDir === false) {
    if (!envFileOff) problems.push('envDir is false but envFile is not false')
  } else if (typeof r.envDir === 'string' && path.resolve(r.envDir) === path.resolve(NO_ENV_DIR)) {
    if (fs.existsSync(NO_ENV_DIR)) {
      const envFiles = fs.readdirSync(NO_ENV_DIR).filter((name) => name.startsWith('.env'))
      problems.push(envFiles.length ? `offline envDir holds ${envFiles.join(', ')}` : 'offline envDir exists (must not be created)')
    }
  } else {
    problems.push('envDir is neither false (with envFile false) nor the empty offline directory')
  }
  return problems
}

const offlineGuard: Plugin = {
  name: 'cocotrip-vitest-offline-20261017-guard',
  enforce: 'post',
  configResolved(resolved) {
    const problems: string[] = envProblems(resolved)
    // Key names only — values are never printed.
    const prefixes = ([] as string[]).concat(resolved.envPrefix || 'VITE_')
    const loaded = Object.keys(resolved.env).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
    if (loaded.length) problems.push(`env keys loaded from files/process env: ${loaded.join(', ')}`)
    if (resolved.server.proxy && Object.keys(resolved.server.proxy).length) problems.push('server.proxy is set')
    if (resolved.server.host !== '127.0.0.1') problems.push('server.host is not exactly 127.0.0.1')
    if (problems.length) throw new Error(`[vitest-offline-config] refusing to run: ${problems.join('; ')}`)
  },
}

const merged = mergeConfig(baseConfig, defineConfig({
  root: REPO_ROOT,
  envDir: NO_ENV_DIR,
  plugins: [offlineGuard],
  server: {
    host: '127.0.0.1',
    hmr: false,
    open: false,
  },
  test: {
    pool: 'forks',
    maxWorkers: 2,
    isolate: true,
    watch: false,
  },
})) as ReturnType<typeof mergeConfig> & { envFile?: boolean }
merged.envFile = false

export default merged
