import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  // Keep the root .env available for future server-side adapters. Only VITE_*
  // variables are exposed to the browser by Vite.
  envDir: path.resolve(process.cwd(), '..'),
})
