import createMDX from '@next/mdx'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
}

const withMDX = createMDX({})

// Merge MDX config with Next.js config
export default withMDX(nextConfig)
