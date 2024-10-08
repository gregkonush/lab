import { SessionProvider } from 'next-auth/react'

export default function PracticeLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-[calc(100vh-10rem)] flex flex-col justify-start items-center">{children}</div>
    </SessionProvider>
  )
}
