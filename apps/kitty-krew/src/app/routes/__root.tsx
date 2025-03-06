import React from 'react'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { CommandPalette } from '~/components/command-palette'

import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query'
import type { AppRouter } from '~/server/routers/_app'
import type { QueryClient } from '@tanstack/react-query'

export interface RouterAppContext {
  trpc: TRPCOptionsProxy<AppRouter>
  queryClient: QueryClient
}

const TanStackRouterDevtools =
  process.env.NODE_ENV === 'production'
    ? () => null
    : React.lazy(() =>
        import('@tanstack/router-devtools').then((res) => ({
          default: res.TanStackRouterDevtools,
        })),
      )

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <div className="min-h-screen flex flex-col antialiased text-zinc-400 w-full">
        <CommandPalette />
        <Outlet />
      </div>
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  )
}
