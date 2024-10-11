import * as React from 'react'
import type { ReactNode } from 'react'

export default function SignUpLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col justify-center items-center min-h-[calc(100vh-10rem)]">{children}</div>
}
