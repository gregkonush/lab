import './globals.css'
import * as k8s from '@kubernetes/client-node'
import { GoogleAnalytics } from '@next/third-parties/google'
import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'
import { auth } from '@/auth'
import { ThemeProvider } from '@/components/theme-provider'
import { UserMenu } from '@/components/user-menu'
import Providers from './providers'
import FeedbackButton from '@/components/feedback-button'
import { Toaster } from '@/components/ui/toaster'

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: {
    template: '%s | ProomptEng',
    default: 'ProomptEng - Practice Programming Problems with AI',
  },
  description: 'Practice programming problems with AI assistance',
  metadataBase: new URL('https://proompteng.ai'),
  robots: {
    index: true,
    follow: true,
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const version = await getAppImageVersion()
  const session = await auth()

  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={`${jetbrains.variable} font-mono tracking-normal antialiased leading-6 text-base bg-zinc-900 text-zinc-300 min-h-screen`}
        suppressHydrationWarning
      >
        <Providers>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            <header className="flex items-center space-x-10 px-10 py-6 border-b border-zinc-800 justify-center">
              <div className="text-2xl uppercase font-bold">
                <Link href="/" className="hover:text-indigo-400 transition-colors duration-200">
                  proompteng<span className="text-indigo-400 hover:text-rose-400">▪</span>ai
                </Link>
              </div>
              <Link href="/problems" className="hover:text-indigo-400 transition-colors duration-200">
                Problems
              </Link>
              <Link href="/practice" className="hover:text-indigo-400 transition-colors duration-200">
                Practice
              </Link>
              {session?.user ? (
                <UserMenu />
              ) : (
                <Link href="/sign-in" className="hover:text-indigo-400 transition-colors duration-200">
                  Sign In
                </Link>
              )}
              <div className="text-zinc-400 absolute right-5 text-sm">Version: {version}</div>
            </header>
            <main className="container py-5">{children}</main>
            <FeedbackButton />
            <Toaster />
          </ThemeProvider>
        </Providers>
      </body>
      <GoogleAnalytics gaId="G-2DDR7KTRFL" />
    </html>
  )
}

async function getAppImageVersion() {
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()

  const k8sApi = kc.makeApiClient(k8s.AppsV1Api)
  const namespace = process.env.NAMESPACE || 'ecran'

  try {
    const res = await k8sApi.readNamespacedDeployment('ecran', namespace)
    const containers = res.body.spec?.template?.spec?.containers

    if (containers && containers.length > 0) {
      const ecranContainer = containers.find((c) => c.name === 'ecran')
      if (ecranContainer) {
        const image = ecranContainer.image
        const version = image?.split(':')?.[1] || 'unknown'
        return version
      }
    }
    return 'unknown'
  } catch (err) {
    console.error('Error fetching deployment:', err)
    return 'unknown'
  }
}
