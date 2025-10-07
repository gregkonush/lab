'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { Icon, type IconName } from '@/components/icon'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar'

const NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: '/app/agents', label: 'Agents', icon: 'Activity' },
]

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar collapsible="icon" className="overflow-hidden">
          <SidebarHeader className="px-3 py-4">
            <div className="flex items-center justify-between overflow-hidden">
              <Link
                href="/"
                className="text-sm font-semibold uppercase tracking-[0.3em] group-data-[collapsible=icon]:hidden group-data-[state=collapsed]:hidden"
              >
                proompteng
              </Link>
              <Link
                href="/"
                aria-label="proompteng"
                className="hidden size-7 items-center justify-center rounded-md border border-border/40 text-xs font-semibold group-data-[collapsible=icon]:flex"
              >
                pe
              </Link>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV_ITEMS.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild tooltip={item.label} isActive={pathname?.startsWith(item.href)}>
                        <Link
                          href={item.href}
                          className="flex min-w-0 items-center gap-2 overflow-hidden group-data-[collapsible=icon]:gap-0 group-data-[state=collapsed]:gap-0"
                        >
                          <Icon name={item.icon} className="size-4 shrink-0" />
                          <span className="truncate text-sm font-medium text-sidebar-foreground group-data-[collapsible=icon]:hidden group-data-[state=collapsed]:hidden">
                            {item.label}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <div className="px-3 group-data-[collapsible=icon]:hidden group-data-[state=collapsed]:hidden">
            <SidebarSeparator className="mx-0" />
          </div>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div className="flex items-start gap-3 border-b border-border/40 px-6 py-4">
            <SidebarTrigger className="-ml-1 mt-1" />
          </div>
          <main className="flex-1 overflow-y-auto px-6 py-10">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
