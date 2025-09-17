import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig(() => ({
  plugins: [
    ...tanstackStart({
      customViteReactPlugin: true,
      target: 'bun',
      tsr: {
        srcDirectory: 'src/app',
      },
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
}))
