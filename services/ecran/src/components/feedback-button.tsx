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
            'bg-indigo-600 text-white',
            'px-3 py-1 rounded-l-md',
            'transform -rotate-90 origin-right',
            'hover:bg-indigo-700 transition-colors duration-200',
          )}
        >
          Feedback
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] space-y-4">
        <SheetHeader>
          <SheetTitle>Provide Feedback</SheetTitle>
        </SheetHeader>
        <FeedbackForm onClose={() => setIsOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
