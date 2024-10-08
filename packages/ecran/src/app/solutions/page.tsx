import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function Solutions() {
  return (
    <div className="prose dark:prose-invert py-16">
      <h2>Solutions</h2>
      <Link href="/solutions/python/next-permutation">Next Permutation</Link>
    </div>
  )
}
