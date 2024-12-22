import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { cn } from '@/lib/utils'
import Script from 'next/script'

const inter = Inter({
  variable: '--font-inter',
  display: 'swap',
  subsets: ['latin'],
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#18181b',
}

export const metadata: Metadata = {
  metadataBase: new URL('https://proompteng.ai'),
  title: {
    default: 'ProomptEng - AI Engineering Platform',
    template: '%s | ProomptEng',
  },
  description: 'ProomptEng is an AI-powered engineering platform that helps teams build better software faster.',
  keywords: ['AI', 'Engineering', 'Platform', 'Software Development', 'Automation'],
  authors: [{ name: 'ProomptEng' }],
  creator: 'ProomptEng',
  publisher: 'ProomptEng',
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
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://proompteng.ai',
    title: 'ProomptEng - AI Engineering Platform',
    description: 'ProomptEng is an AI-powered engineering platform that helps teams build better software faster.',
    siteName: 'ProomptEng',
    images: [
      {
        url: 'https://proompteng.ai/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ProomptEng - AI Engineering Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ProomptEng - AI Engineering Platform',
    description: 'ProomptEng is an AI-powered engineering platform that helps teams build better software faster.',
    creator: '@proompteng',
    images: ['https://proompteng.ai/twitter-image.png'],
  },
  alternates: {
    canonical: 'https://proompteng.ai',
  },
}

const JsonLd = () => {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'ProomptEng',
    description: 'ProomptEng is an AI-powered engineering platform that helps teams build better software faster.',
    url: 'https://proompteng.ai',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://proompteng.ai/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <Script id="json-ld" type="application/ld+json" strategy="worker">
      {JSON.stringify(jsonLd)}
    </Script>
  )
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={cn(
        'min-h-screen bg-slate-950 antialiased',
        'min-w-full mx-auto',
        'prose prose-invert prose-sm prose-slate',
        'prose-headings:text-slate-300/90',
        'prose-p:text-slate-300/80',
        inter.variable,
      )}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <JsonLd />
        {children}
      </body>
    </html>
  )
}
