'use client'

import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
})

type FormData = z.infer<typeof schema>

export function CreateProblemForm() {
  const [error, setError] = useState<string | null>(null)
  const {
    control,
    handleSubmit,
    formState: { errors, isValid, isDirty },
  } = useForm<FormData>({
    defaultValues: {
      title: '',
      description: '',
    },
    mode: 'onChange',
    resolver: zodResolver(schema),
  })

  const router = useRouter()

  const onSubmit = async (data: FormData) => {
    try {
      const response = await fetch('/api/problems', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        const body = await response.json()
        router.push(`/problems/${body?.problemId}`)
      } else {
        setError('Failed to create problem')
      }
    } catch (err) {
      setError('An error occurred while creating the problem')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 min-w-[52rem] self-center">
      <div className="flex space-x-2">
        <Button type="submit" disabled={!isValid || !isDirty}>
          Save
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="space-y-2">
        <Label htmlFor="title">Problem Name</Label>
        <Controller
          name="title"
          control={control}
          render={({ field }) => <Input {...field} id="title" placeholder="Problem Name..." className="bg-zinc-800" />}
        />
        {errors.title && <p className="text-destructive text-sm">{errors.title.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <Textarea
              {...field}
              id="description"
              placeholder="Paste or type your description here..."
              className="min-h-[24rem] bg-zinc-800"
            />
          )}
        />
        {errors.description && <p className="text-destructive text-sm">{errors.description.message}</p>}
      </div>
    </form>
  )
}
