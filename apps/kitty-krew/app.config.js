import { createApp } from 'vinxi'
import reactRefresh from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default createApp({
  server: {
    preset: 'bun', // change to 'netlify' or 'bun' or anyof the supported presets for nitro (nitro.unjs.io)
    experimental: {
      asyncContext: true,
    },
  },
  routers: [
    {
      type: 'static',
      name: 'public',
      dir: './public',
    },
    {
      type: 'http',
      name: 'trpc',
      base: '/trpc',
      handler: './src/server/handler.ts',
      target: 'server',
      plugins: () => [tsconfigPaths()],
    },
    {
      type: 'spa',
      name: 'client',
      handler: './index.html',
      target: 'browser',
      plugins: () => [
        TanStackRouterVite({
          target: 'react',
          autoCodeSplitting: true,
          routesDirectory: './src/app/routes',
          generatedRouteTree: './src/app/routeTree.gen.ts',
        }),
        reactRefresh(),
        tailwindcss(),
        tsconfigPaths(),
      ],
    },
  ],
})
