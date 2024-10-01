import React from 'react'
import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })

export const metadata: Metadata = {
  title: 'ProomptEng.AI - Where Developers Learn, Share, & Build Careers',
  description:
    'ProomptEng.AI is the largest, most trusted online community for developers to learn, share their prompt engineering knowledge.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jetbrains.variable} font-mono`} suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <header className="flex items-center space-x-10 px-10 py-4 border-b border-gray-800">
            <div className="text-2xl uppercase">
              <Link href="/">
                proompteng<span className="text-indigo-400">▪</span>ai
              </Link>
            </div>
            <Link href="/problems" className="hover:underline">
              Problems
            </Link>
            <Link href="/solutions" className="hover:underline">
              Solutions
            </Link>
            <Link href="/practice" className="hover:underline">
              Practice
            </Link>
          </header>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
