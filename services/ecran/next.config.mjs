import MillionLint from '@million/lint'
import createMDX from '@next/mdx'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  experimental: {
    serverComponentsExternalPackages: ['pino', 'pino-pretty'],
  },
}

const withMDX = createMDX({})

export default MillionLint.next({
  enabled: false,
  rsc: true,
  server: true,
  telemetry: false,
  framework: 'next',
})(withMDX(nextConfig))
