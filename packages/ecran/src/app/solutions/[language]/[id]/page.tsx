import { MDXRemote } from 'next-mdx-remote/rsc'
import rehypeHighlight from 'rehype-highlight'
import '@/styles/tokyo-night-dark.css'
import fs from 'node:fs'

export default function Home() {
  const source = fs.readFileSync(`${process.cwd()}/src/solutions/next-permutation.md`, 'utf8')
  return (
    <div className="bg-[#1a1b26] rounded-lg">
      <MDXRemote
        source={source}
        options={{
          mdxOptions: {
            remarkPlugins: [],
            rehypePlugins: [rehypeHighlight],
          },
        }}
      />
    </div>
  )
}
