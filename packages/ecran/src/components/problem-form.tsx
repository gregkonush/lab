'use client'

import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Button } from '@/components/ui/button'
import { ComboSelect } from '@/components/combo-select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const schema = yup
  .object({
    title: yup.string().required('Title is required'),
    difficulty: yup
      .string()
      .oneOf(['easy', 'medium', 'hard'], 'Please select a difficulty')
      .required('Difficulty is required'),
    tags: yup.array().of(yup.string()).required('At least one tag is required'),
    description: yup.string().required('Description is required'),
  })
  .required()

type FormData = yup.InferType<typeof schema>

export function CreateProblemForm() {
  const [error, setError] = useState<string | null>(null)
  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      title: '',
      difficulty: 'easy',
      tags: [],
      description: '',
    },
  })

  const router = useRouter()

  const onSubmit = async (data: FormData) => {
    console.log(data)
    const response = await fetch('/api/problems', {
      method: 'POST',
      body: JSON.stringify(data),
    })

    if (response.ok) {
      const body = await response.json()
      router.push(`/problems/${body?.problemId}`)
    } else {
      setError('Failed to create problem')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 min-w-full">
      <Button size="sm" type="submit" disabled={!isValid}>
        Save
      </Button>
      {error && <p className="text-rose-500/90 text-xs h-4 pt-1.5">{error}</p>}
      <div>
        <Label htmlFor="title">Problem Name</Label>
        <Controller
          name="title"
          control={control}
          render={({ field }) => <Input {...field} id="title" placeholder="Problem Name..." />}
        />
        <p className="text-rose-500/90 text-xs h-4 pt-1.5">{errors.title?.message}</p>
      </div>

      <div className="flex flex-row space-x-4">
        <div className="w-36">
          <Label htmlFor="difficulty">Difficulty</Label>
          <Controller
            name="difficulty"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger id="difficulty">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-rose-500/90 text-xs h-4 pt-1.5">{errors.difficulty?.message}</p>
        </div>
        <div>
          <Label htmlFor="tags">Tags</Label>
          <Controller
            name="tags"
            control={control}
            render={({ field }) => (
              <ComboSelect
                value={field.value.join(',')}
                onChange={(value) => field.onChange([value])}
                onBlur={field.onBlur}
                name={field.name}
              />
            )}
          />
          <p className="text-rose-500/90 text-xs h-4 pt-1.5">{errors.tags?.message}</p>
        </div>
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <Textarea {...field} id="description" placeholder="Paste or type your description here..." className="min-h-96" />
          )}
        />
        <p className="text-rose-500/90 text-xs h-4 pt-1.5">{errors.description?.message}</p>
      </div>
    </form>
  )
}