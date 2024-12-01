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
    default: 'ProomptEng - AI-Powered Programming Practice Platform',
  },
  description:
    'Level up your coding skills with ProomptEng - An innovative AI-powered platform for practicing programming problems. Get real-time feedback, personalized assistance, and improve your problem-solving abilities.',
  metadataBase: new URL('https://proompteng.ai'),
  keywords:
    'programming practice, coding problems, AI assistance, learning to code, algorithm practice, coding interview prep, programming exercises',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://proompteng.ai',
    siteName: 'ProomptEng',
    title: 'ProomptEng - AI-Powered Programming Practice Platform',
    description:
      'Level up your coding skills with ProomptEng - An innovative AI-powered platform for practicing programming problems.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ProomptEng - AI-Powered Programming Practice',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ProomptEng - AI-Powered Programming Practice Platform',
    description:
      'Level up your coding skills with ProomptEng - An innovative AI-powered platform for practicing programming problems.',
    images: ['/og-image.png'],
    creator: '@proompteng',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const version = await getAppImageVersion()
  const session = await auth()

  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={`${jetbrains.variable} min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-950 font-mono text-base leading-6 tracking-normal text-zinc-300 antialiased`}
        suppressHydrationWarning
      >
        <Providers>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            <header className="relative flex items-center justify-center space-x-10 border-b border-zinc-800/50 bg-zinc-900/30 px-10 py-6 backdrop-blur-sm">
              <div
                className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
                aria-hidden="true"
              >
                <div className="relative left-[50%] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[45deg] bg-gradient-to-br from-indigo-400 to-pink-400 opacity-20" />
              </div>
              <div className="group text-2xl font-bold uppercase">
                <Link href="/" className="relative transition-all duration-300 hover:text-indigo-400">
                  proompteng
                  <span className="inline-block text-indigo-400 transition-all duration-300 group-hover:animate-pulse group-hover:text-rose-400">
                    ▪
                  </span>
                  ai
                  <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-indigo-400 transition-all duration-300 group-hover:w-full" />
                </Link>
              </div>
              <Link href="/problems" className="group relative transition-colors duration-200 hover:text-indigo-400">
                Problems
                <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-indigo-400 transition-all duration-300 group-hover:w-full" />
              </Link>
              <Link href="/practice" className="group relative transition-colors duration-200 hover:text-indigo-400">
                Practice
                <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-indigo-400 transition-all duration-300 group-hover:w-full" />
              </Link>
              {session?.user ? (
                <UserMenu />
              ) : (
                <Link href="/sign-in" className="group relative transition-colors duration-200 hover:text-indigo-400">
                  Sign In
                  <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-indigo-400 transition-all duration-300 group-hover:w-full" />
                </Link>
              )}
              <div className="absolute right-5 text-sm text-zinc-400">Version: {version}</div>
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
  if (process.env.NODE_ENV !== 'production') {
    return 'latest'
  }

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
