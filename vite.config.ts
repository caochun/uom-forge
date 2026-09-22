import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createApiMiddleware } from './server/api.ts'

const envDirectory = path.resolve(import.meta.dirname)
const packageJson = JSON.parse(readFileSync(path.join(envDirectory, 'package.json'), 'utf8')) as {
  version?: string
}

const gitValue = (args: string[], fallback: string) => {
  try {
    return execFileSync('git', args, { cwd: envDirectory, encoding: 'utf8' }).trim() || fallback
  } catch {
    return fallback
  }
}

const appVersion = packageJson.version ?? 'unknown'
const appCommit = gitValue(['rev-parse', 'HEAD'], 'unknown')
const appShortCommit = appCommit === 'unknown' ? 'unknown' : appCommit.slice(0, 7)
const appCommitTime = gitValue(['show', '-s', '--format=%cI', 'HEAD'], 'unknown')
const appBuildTime = new Date().toISOString()

for (const [key, value] of Object.entries(
  loadEnv(
    process.env.NODE_ENV === 'production' ? 'production' : 'development',
    envDirectory,
    '',
  ),
)) {
  if (process.env[key] === undefined) process.env[key] = value
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
    __APP_SHORT_COMMIT__: JSON.stringify(appShortCommit),
    __APP_COMMIT_TIME__: JSON.stringify(appCommitTime),
    __APP_BUILD_TIME__: JSON.stringify(appBuildTime),
    __APP_ENV__: JSON.stringify(process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  },
  server: { host: '0.0.0.0', allowedHosts: ['onto.njuics.cn'] },
  // qq-doc-clone is a linked (file:) package, so the dependency scanner does
  // not reliably reach its CommonJS transitive dependency on a cold cache;
  // without prebundling, the browser imports the raw CJS file and fails on
  // the named export. Include the chain explicitly (Vite's monorepo recipe).
  optimizeDeps: {
    include: ['qq-doc-clone > @tiptap/react > use-sync-external-store/shim'],
  },
  plugins: [
    react(),
    {
      name: 'uom-forge-api',
      configureServer(server) {
        server.middlewares.use(createApiMiddleware())
      },
    },
  ],
  envDir: envDirectory,
})
