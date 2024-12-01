'use client'

import { useState } from 'react'
import FeedbackForm from '@/components/feedback-form'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export default function FeedbackButton({ userId }: { userId?: string }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          className={cn(
            'fixed right-4 top-1/2 -translate-y-1/2',
            'border border-zinc-700 bg-zinc-800 text-white',
            'rounded-l-md px-3 py-1',
            'origin-right -rotate-90 transform',
            'transition-colors duration-200 hover:bg-zinc-700',
          )}
        >
          Feedback
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] space-y-4 sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>Provide Feedback</SheetTitle>
        </SheetHeader>
        <FeedbackForm onClose={() => setIsOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
