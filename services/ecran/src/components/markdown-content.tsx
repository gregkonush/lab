import { cn } from '@/lib/utils'
import { MDXRemote } from 'next-mdx-remote/rsc'
import rehypeHighlight from 'rehype-highlight'

interface MarkdownContentProps {
  content: string
  className?: string
  useMDX?: boolean
}

export function MarkdownContent({ content, className, useMDX = true }: MarkdownContentProps) {
  const sharedClasses = cn(
    'prose-sm dark:prose-invert max-w-none text-zinc-200',
    'prose-pre:text-[1.05rem] prose-pre:rounded prose-pre:whitespace-pre',
    'prose-pre:overflow-x-auto prose-pre:p-0 prose-pre:bg-zinc-900',
    'prose-code:text-indigo-400 prose-code:rounded prose-code:bg-zinc-900',
    'prose-code:px-1 prose-code:py-0.5 prose-code:font-semibold',
    "prose-code:before:content-[''] prose-code:after:content-['']",
    'prose-inline-code:text-[.95rem]',
    className,
  )

  if (useMDX) {
    return (
      <div className={sharedClasses}>
        <MDXRemote
          source={content}
          options={{
            mdxOptions: {
              rehypePlugins: [[rehypeHighlight, { detect: true, ignoreMissing: true }]],
            },
          }}
        />
      </div>
    )
  }

  return <div className={sharedClasses}>{content}</div>
}
