'use client'

import { createContext, useContext, useState } from 'react'

interface SolutionState {
  solution: string | null
  isLoading: boolean
  setSolution: (solution: string | null) => void
  setIsLoading: (isLoading: boolean) => void
}

const SolutionStateContext = createContext<SolutionState>({
  solution: null,
  isLoading: false,
  setSolution: () => {},
  setIsLoading: () => {},
})

export function SolutionStateProvider({ children }: { children: React.ReactNode }) {
  const [solution, setSolution] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  return (
    <SolutionStateContext.Provider
      value={{
        solution,
        isLoading,
        setSolution,
        setIsLoading,
      }}
    >
      {children}
    </SolutionStateContext.Provider>
  )
}

export function useSolutionState() {
  return useContext(SolutionStateContext)
}
