import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://proompteng.ai"),
  title: {
    default:
      "AI Agent Deployment Platform — Framework‑Agnostic | ProomptEng AI",
    template: "%s — ProomptEng AI",
  },
  description:
    "Deploy, observe, and govern AI agents across languages and clouds. Framework‑agnostic, production‑ready.",
  applicationName: "ProomptEng AI",
  keywords: [
    "AI agent deployment platform",
    "framework‑agnostic AI agents",
    "agent observability",
    "AI guardrails",
    "production AI agents",
    "RAG and vector stores",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "ProomptEng AI",
    title: "AI Agent Deployment Platform — Framework‑Agnostic | ProomptEng AI",
    description:
      "Deploy, observe, and govern AI agents across languages and clouds.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "ProomptEng AI",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ProomptEng AI",
    description: "Framework‑agnostic AI agent platform.",
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ProomptEng AI",
    url: "https://proompteng.ai",
    description:
      "Framework‑agnostic AI platform to build, deploy, and operate AI agents.",
    publisher: {
      "@type": "Organization",
      name: "ProomptEng AI",
      url: "https://proompteng.ai",
      logo: {
        "@type": "ImageObject",
        url: "https://proompteng.ai/favicon.svg",
      },
      sameAs: ["https://github.com/gregkonush/lab"],
    },
  };
  const productLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ProomptEng AI",
    applicationCategory: "AI Platform",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    url: "https://proompteng.ai",
    description:
      "Deploy, observe, and govern AI agents across languages and clouds.",
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Does ProomptEng require a specific framework?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. It works with any language or framework.",
        },
      },
      {
        "@type": "Question",
        name: "Can I deploy on‑premise?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. Run in your cloud or on‑prem environments.",
        },
      },
    ],
  };
  return (
    <html lang="en" className="dark">
      <body
        className={`${dmSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <Script
          id="ld+json-website"
          type="application/ld+json"
          strategy="afterInteractive"
        >
          {JSON.stringify(jsonLd)}
        </Script>
        <Script
          id="ld+json-product"
          type="application/ld+json"
          strategy="afterInteractive"
        >
          {JSON.stringify(productLd)}
        </Script>
        <Script
          id="ld+json-faq"
          type="application/ld+json"
          strategy="afterInteractive"
        >
          {JSON.stringify(faqLd)}
        </Script>
        {children}
      </body>
    </html>
  );
}
