import * as React from 'react'
import type { ReactNode } from 'react'

export default function SignInLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">{children}</div>
}
