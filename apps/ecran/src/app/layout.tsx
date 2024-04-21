import type { Metadata } from "next"
import { JetBrains_Mono } from "next/font/google"
import "./globals.css"

const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" })

export const metadata: Metadata = {
  title: "ProomptEng.AI - Where Developers Learn, Share, & Build Careers",
  description:
    "ProomptEng.AI is the largest, most trusted online community for developers to learn, share their prompt engineering knowledge.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${jetbrains.variable} font-mono`}>{children}</body>
    </html>
  )
}
