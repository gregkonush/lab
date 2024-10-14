'use client'

import React, { useState, memo } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { invalidateRootLayout } from '../sign-in/actions'

const signUpSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
})

const MemoizedFormControl = memo(FormControl)

export default function SignUp() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  })
  const handleInvalidation = async () => {
    await invalidateRootLayout()
  }

  const onSubmit = async (values: z.infer<typeof signUpSchema>) => {
    setError(null)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })

      if (response.ok) {
        await handleInvalidation()
        router.push('/practice')
      } else {
        const data = await response.json()
        setError(data.message || 'An error occurred')
      }
    } catch (err) {
      setError('An error occurred')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 min-w-[300px]">
        {error && <div className="text-rose-500/90 text-sm text-center">{error}</div>}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <MemoizedFormControl>
                <Input placeholder="Your Name" {...field} className="w-full" />
              </MemoizedFormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <MemoizedFormControl>
                <Input type="email" placeholder="you@example.com" {...field} className="w-full" />
              </MemoizedFormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <MemoizedFormControl>
                <Input type="password" placeholder="Your Password" {...field} className="w-full" />
              </MemoizedFormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full">
          Sign Up
        </Button>
      </form>
    </Form>
  )
}
