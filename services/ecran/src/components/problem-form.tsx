'use client'

import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { ComboSelect } from '@/components/combo-select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  difficulty: z.enum(['easy', 'medium', 'hard'], {
    required_error: 'Difficulty is required',
  }),
  tags: z.array(z.string()).min(1, 'At least one tag is required'),
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
      difficulty: 'easy',
      tags: [],
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

      <div className="flex flex-row space-x-4">
        <div className="w-36 space-y-2">
          <Label htmlFor="difficulty">Difficulty</Label>
          <Controller
            name="difficulty"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger id="difficulty" className="bg-zinc-800">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          {errors.difficulty && <p className="text-destructive text-sm">{errors.difficulty.message}</p>}
        </div>
        <div className="space-y-2 flex-grow">
          <div className="space-y-2 w-[30rem]">
            <Label htmlFor="tags">Tags</Label>
            <Controller
              name="tags"
              control={control}
              render={({ field }) => (
                <ComboSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} name={field.name} />
              )}
            />
            {errors.tags && <p className="text-destructive text-sm">{errors.tags.message}</p>}
          </div>
        </div>
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
