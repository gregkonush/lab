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
    default: "deploy ai agents to production",
    template: "%s — proompteng",
  },
  description:
    "deploy, observe, and govern ai agents across languages and clouds. framework‑agnostic, production‑ready.",
  applicationName: "proompteng",
  keywords: [
    "ai agent deployment platform",
    "framework‑agnostic ai agents",
    "agent observability",
    "ai guardrails",
    "production ai agents",
    "rag and vector stores",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "proompteng",
    title: "deploy ai agents to production",
    description:
      "deploy, observe, and govern ai agents across languages and clouds.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "proompteng",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "proompteng",
    description: "framework‑agnostic ai agent platform.",
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
    name: "proompteng",
    url: "https://proompteng.ai",
    description:
      "framework‑agnostic ai platform to build, deploy, and operate ai agents.",
    publisher: {
      "@type": "Organization",
      name: "proompteng",
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
    name: "proompteng",
    applicationCategory: "ai platform",
    operatingSystem: "any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    url: "https://proompteng.ai",
    description:
      "deploy, observe, and govern ai agents across languages and clouds.",
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "does proompteng require a specific framework?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "no. it works with any language or framework.",
        },
      },
      {
        "@type": "Question",
        name: "can i deploy on‑premise?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "yes. run in your cloud or on‑prem environments.",
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
