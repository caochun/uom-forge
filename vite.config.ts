import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createApiMiddleware } from './server/api.ts'

const envDirectory = path.resolve(import.meta.dirname)
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
