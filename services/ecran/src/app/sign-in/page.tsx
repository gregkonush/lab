'use client'

import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState } from 'react'
import { invalidateRootLayout } from './actions'

export default function SignIn() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const handleInvalidation = async () => {
    await invalidateRootLayout()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const result = await signIn('credentials', {
      redirect: false,
      email,
      password,
    })

    if (result?.error) {
      setError('Invalid email or password')
    } else {
      await handleInvalidation()
      router.push('/practice')
    }
  }

  return (
    <div className="flex flex-col items-center space-y-4 min-w-[20rem]">
      <div className="text-2xl font-thin">Welcome Back</div>
      <form onSubmit={handleSubmit} className="flex flex-col items-start space-y-4 w-full">
        {error ? <p className="text-rose-500/90 text-sm w-full text-center">{error}</p> : <div className="h-5" />}
        <Label htmlFor="email" className="">
          Email
        </Label>
        <Input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" className="w-full">
          Sign In
        </Button>
      </form>
      <p className="text-sm">
        Don&apos;t have an account?{' '}
        <Link href="/sign-up" className="text-blue-500 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
