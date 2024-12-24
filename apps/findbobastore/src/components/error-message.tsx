import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface ErrorMessageProps {
  title: string
  description?: ReactNode
  className?: string
}

export function ErrorMessage({ title, description, className }: ErrorMessageProps) {
  return (
    <Alert variant="destructive" className={cn('border-red-900/50 bg-red-900/10', className)}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      {description && <AlertDescription>{description}</AlertDescription>}
    </Alert>
  )
}
