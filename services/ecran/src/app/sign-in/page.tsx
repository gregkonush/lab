'use client'

import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState } from 'react'

export default function SignIn() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await signIn('credentials', {
      redirectTo: '/practice',
      email,
      password,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-start space-y-2">
      {error && <p className="text-rose-500/90 text-xs h-4 pt-1.5">{error}</p>}
      <Label htmlFor="email">Email</Label>
      <Input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

      <Label htmlFor="password">Password</Label>
      <Input
        id="password"
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <Button type="submit">Sign In</Button>
    </form>
  )
}
