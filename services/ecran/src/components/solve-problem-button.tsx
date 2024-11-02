'use client'

import { Button } from '@/components/ui/button'
import { startSolveProblemWorkflow } from '@/actions/solve-problem-workflow'
import { useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useSolutionState } from './solution-state-provider'

export function SolveProblemButton({ problemId }: { problemId: string }) {
  const { setIsLoading, isLoading } = useSolutionState()
  const { toast } = useToast()

  const handleSolveProblem = useCallback(async () => {
    try {
      setIsLoading(true)
      toast({
        title: 'Success',
        description: 'Started solving problem',
        duration: 1000,
      })
      const result = await startSolveProblemWorkflow(problemId)

      if (result?.error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.error,
        })
        return
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to start solve workflow',
      })
      console.error('Failed to start solve workflow:', error)
    } finally {
      setIsLoading(false)
    }
  }, [problemId, setIsLoading, toast])

  return (
    <Button
      onClick={handleSolveProblem}
      disabled={isLoading}
      aria-label="Solve problem using AI"
      variant="default"
      className="w-16"
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Solve'}
    </Button>
  )
}
