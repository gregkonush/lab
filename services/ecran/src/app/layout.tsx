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
        className={`${jetbrains.variable} font-mono tracking-normal antialiased leading-6 text-base bg-gradient-to-b from-zinc-900 to-zinc-950 text-zinc-300 min-h-screen`}
        suppressHydrationWarning
      >
        <Providers>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            <header className="flex items-center space-x-10 px-10 py-6 border-b border-zinc-800/50 justify-center backdrop-blur-sm bg-zinc-900/30 relative">
              <div
                className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
                aria-hidden="true"
              >
                <div className="relative left-[50%] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[45deg] bg-gradient-to-br from-indigo-400 to-pink-400 opacity-20" />
              </div>
              <div className="text-2xl uppercase font-bold group">
                <Link href="/" className="hover:text-indigo-400 transition-all duration-300 relative">
                  proompteng
                  <span className="text-indigo-400 group-hover:text-rose-400 inline-block transition-all duration-300 group-hover:animate-pulse">
                    ▪
                  </span>
                  ai
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-indigo-400 group-hover:w-full transition-all duration-300" />
                </Link>
              </div>
              <Link href="/problems" className="relative group hover:text-indigo-400 transition-colors duration-200">
                Problems
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-indigo-400 group-hover:w-full transition-all duration-300" />
              </Link>
              <Link href="/practice" className="relative group hover:text-indigo-400 transition-colors duration-200">
                Practice
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-indigo-400 group-hover:w-full transition-all duration-300" />
              </Link>
              {session?.user ? (
                <UserMenu />
              ) : (
                <Link href="/sign-in" className="relative group hover:text-indigo-400 transition-colors duration-200">
                  Sign In
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-indigo-400 group-hover:w-full transition-all duration-300" />
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
