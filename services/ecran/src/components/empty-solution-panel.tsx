'use client'

import { useSolutionState } from './solution-state-provider'
import Image from 'next/image'

export function EmptySolutionPanel() {
  const { solution, isLoading } = useSolutionState()

  if (!solution && !isLoading) {
    return (
      <div className="text-zinc-400 text-sm flex flex-col items-center justify-center h-full bg-zinc-800 rounded">
        <p>
          No solution yet, click the <span className="font-semibold">Solve</span> button to generate a solution
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="h-full animate-pulse bg-zinc-800 rounded flex items-center justify-center">
        <Image src="/seal.png" alt="Loading..." width={200} height={200} className="animate-ping" />
      </div>
    )
  }
}
