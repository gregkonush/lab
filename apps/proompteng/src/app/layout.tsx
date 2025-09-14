import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import Script from "next/script";

const inter = Inter({
  variable: "--font-inter",
  display: "swap",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#020817",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://proompteng.ai"),
  title: {
    default: "ProomptEng - Latest Tech & AI News",
    template: "%s | ProomptEng",
  },
  description:
    "Stay updated with the latest news in AI, Tech, and Prompt Engineering. Get insights on GPT-4, Claude, and emerging technologies.",
  keywords: [
    "AI News",
    "Tech News",
    "Prompt Engineering",
    "GPT-4",
    "Claude AI",
    "AI Updates",
  ],
  authors: [{ name: "ProomptEng" }],
  creator: "ProomptEng",
  publisher: "ProomptEng",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      {
        url: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: { url: "/apple-icon.png" },
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://proompteng.ai",
    title: "ProomptEng - Latest Tech & AI News",
    description:
      "Stay updated with the latest news in AI, Tech, and Prompt Engineering",
    siteName: "ProomptEng",
    images: [
      {
        url: "/android-chrome-512x512.png",
        width: 512,
        height: 512,
        alt: "ProomptEng Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ProomptEng - Latest Tech & AI News",
    description:
      "Stay updated with the latest news in AI, Tech, and Prompt Engineering",
    images: ["/android-chrome-512x512.png"],
    creator: "@proompteng",
  },
  alternates: {
    canonical: "https://proompteng.ai",
  },
};

const JsonLd = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ProomptEng",
    description:
      "Stay updated with the latest news in AI, Tech, and Prompt Engineering",
    url: "https://proompteng.ai",
    publisher: {
      "@type": "Organization",
      name: "ProomptEng",
      logo: {
        "@type": "ImageObject",
        url: "https://proompteng.ai/android-chrome-512x512.png",
      },
    },
    image: {
      "@type": "ImageObject",
      url: "https://proompteng.ai/android-chrome-512x512.png",
      width: 512,
      height: 512,
    },
  };

  return (
    <Script id="json-ld" type="application/ld+json" strategy="worker">
      {JSON.stringify(jsonLd)}
    </Script>
  );
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn(
        "dark",
        "min-h-screen bg-slate-950 antialiased",
        "min-w-full mx-auto",
        "prose prose-invert prose-slate",
        "prose-headings:text-slate-300/90",
        "prose-p:text-slate-300/80",
        inter.variable,
      )}
      suppressHydrationWarning
    >
      <body>
        <JsonLd />
        {children}
      </body>
    </html>
  );
}
