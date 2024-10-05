import * as k8s from '@kubernetes/client-node'
import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'ProomptEng.AI - Where Developers Learn, Share, & Build Careers',
  description:
    'ProomptEng.AI is the largest, most trusted online community for developers to learn, share their prompt engineering knowledge.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const version = await getAppImageVersion()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jetbrains.variable} font-mono`} suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <header className="flex items-center space-x-10 px-10 py-4 border-b border-zinc-900 justify-center">
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
            <div className="text-zinc-400">Version: {version}</div>
          </header>
          {children}
        </ThemeProvider>
      </body>
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
