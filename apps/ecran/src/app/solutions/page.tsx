'use server'
import Link from 'next/link'

export default async function Solutions() {
  console.log(process.env)
  return (
    <div className="prose dark:prose-invert py-16">
      <h2>Solutions</h2>
      <Link href="/solutions/python/next-permutation">Next Permutation</Link>
    </div>
  )
}
