'use client'

import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition, useState, useEffect } from 'react'
import { useDebounceValue } from 'usehooks-ts'

export default function SearchProblems({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [searchTerm, setSearchTerm] = useState(defaultValue ?? '')
  const [debouncedValue] = useDebounceValue(searchTerm, 300)

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    const currentSearch = params.get('search') ?? ''

    if (debouncedValue) {
      params.set('search', debouncedValue)
    } else {
      params.delete('search')
    }

    if (currentSearch !== debouncedValue) {
      params.set('page', '1')
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }, [debouncedValue, pathname, router, searchParams])

  return (
    <div className="relative w-72">
      <Search
        className={`absolute left-2 top-2.5 h-4 w-4 ${
          isPending ? 'text-zinc-400' : 'text-zinc-500'
        }`}
      />
      <Input
        type="search"
        placeholder="Search problems..."
        className="pl-8"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        aria-label="Search problems"
      />
    </div>
  )
}
