export default function SolutionsLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <div className="flex flex-col items-center min-h-screen prose dark:prose-invert min-w-full">{children}</div>
}
