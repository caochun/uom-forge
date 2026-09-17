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
