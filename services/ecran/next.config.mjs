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

export default withMDX(nextConfig)
