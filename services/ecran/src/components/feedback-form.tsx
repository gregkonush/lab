'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { useState, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'

const feedbackSchema = z.object({
  content: z.string().min(10, 'Feedback must be at least 10 characters long'),
})

type FeedbackFormData = z.infer<typeof feedbackSchema>

interface FeedbackFormProps {
  onClose: () => void
}

export default function FeedbackForm({ onClose }: FeedbackFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  const form = useForm<FeedbackFormData>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      content: '',
    },
  })

  const onSubmit = useCallback(
    async (data: FeedbackFormData) => {
      setIsSubmitting(true)
      try {
        const currentUrl = window.location.href
        const feedbackData = {
          content: data.content,
          url: currentUrl,
        }

        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(feedbackData),
        })

        if (!response.ok) {
          throw new Error('Failed to submit feedback')
        }

        toast({
          title: 'Feedback Submitted',
          description: 'Thank you for your feedback!',
          duration: 2000,
        })
        onClose()
      } catch (error) {
        console.error('Failed to submit feedback', error)
        toast({
          title: 'Error',
          description: 'Failed to submit feedback. Please try again.',
          variant: 'destructive',
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [onClose, toast],
  )

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea
                  {...field}
                  placeholder="Enter your feedback here..."
                  className="min-h-[200px] resize-none"
                  aria-label="Feedback content"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </Button>
      </form>
    </Form>
  )
}
