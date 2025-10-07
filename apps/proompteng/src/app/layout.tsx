import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import Script from 'next/script'
import Providers from '@/components/providers'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://proompteng.ai'),
  title: {
    default: 'proompteng – Ship AI agents with a control plane built for engineers',
    template: '%s — proompteng',
  },
  description:
    'proompteng is the control plane that lets software teams launch, govern, and scale AI agents with guardrails, observability, and model freedom across any stack.',
  applicationName: 'proompteng',
  keywords: [
    'ai agent control plane',
    'ai agent platform',
    'ai agent devtools',
    'ai guardrails',
    'agent observability',
    'policy as code',
    'multi model orchestration',
    'ai infrastructure',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'proompteng',
    title: 'proompteng – Ship AI agents with a control plane built for engineers',
    description:
      'Launch, govern, and scale AI agents with guardrails, observability, and model freedom across any stack.',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'proompteng AI agent control plane',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'proompteng – Ship AI agents',
    description:
      'Control plane for engineers to launch, govern, and scale AI agents with guardrails and observability.',
    images: ['/opengraph-image'],
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: '/favicon.ico' }, { url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.ico',
  },
  manifest: '/site.webmanifest',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e10' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'proompteng',
    url: 'https://proompteng.ai',
    description:
      'Control plane for engineers to launch, govern, and scale AI agents with guardrails, observability, and model freedom.',
    publisher: {
      '@type': 'Organization',
      name: 'proompteng',
      url: 'https://proompteng.ai',
      logo: {
        '@type': 'ImageObject',
        url: 'https://proompteng.ai/favicon.svg',
      },
      contactPoint: [
        {
          '@type': 'ContactPoint',
          email: 'greg@proompteng.ai',
          contactType: 'sales',
          areaServed: 'Worldwide',
          availableLanguage: ['English'],
        },
      ],
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://docs.proompteng.ai?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  }
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'proompteng',
    applicationCategory: 'AIPlatform',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    url: 'https://proompteng.ai',
    description:
      'Launch, govern, and scale AI agents with policy-as-code guardrails, observability, and model freedom across any stack.',
    downloadUrl: 'https://docs.proompteng.ai',
    softwareVersion: '1.0',
    featureList: [
      'Policy-as-code guardrails',
      'Observability and replay',
      'Multi-model routing',
      'Agent memory integrations',
    ],
    creator: {
      '@type': 'Organization',
      name: 'proompteng',
      url: 'https://proompteng.ai',
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'greg@proompteng.ai',
        contactType: 'sales',
      },
    },
  }
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'does proompteng require a specific framework?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'no. it works with any language or framework.',
        },
      },
      {
        '@type': 'Question',
        name: 'can i deploy on‑premise?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'yes. run in your cloud or on‑prem environments.',
        },
      },
    ],
  }
  return (
    <html lang="en" className="dark scroll-smooth">
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased`}>
        <Providers>
          <Script id="ld+json-website" type="application/ld+json" strategy="afterInteractive">
            {JSON.stringify(jsonLd)}
          </Script>
          <Script id="ld+json-product" type="application/ld+json" strategy="afterInteractive">
            {JSON.stringify(productLd)}
          </Script>
          <Script id="ld+json-faq" type="application/ld+json" strategy="afterInteractive">
            {JSON.stringify(faqLd)}
          </Script>
          {children}
        </Providers>
      </body>
    </html>
  )
}
