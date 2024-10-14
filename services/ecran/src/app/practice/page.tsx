'use client'

import { useReducer, useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import PracticeView from '@/components/practice-view'

type Problem = {
  id: string
  title: string
  description: string
  difficulty: string
  tags: string[]
  codeTemplates: Record<string, string>
}

const defaultJavaCode = `
String greet(String name) {
    return "Hello, " + name + "!";
}
System.out.println(greet("World"));
`.trim()

const defaultTypeScriptCode = `
function greet(name: string): string {
    return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`.trim()

const defaultJavaScriptCode = `
function greet(name) {
    return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`.trim()

const defaultPythonCode = `
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
`.trim()

const defaultProblem =
  `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.



Example 1:

Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
Example 2:

Input: nums = [3,2,4], target = 6
Output: [1,2]
Example 3:

Input: nums = [3,3], target = 6
Output: [0,1]


Constraints:

2 <= nums.length <= 104
-109 <= nums[i] <= 109
-109 <= target <= 109
Only one valid answer exists.
`.trim()

type State = {
  code: string
  language: string
  output: string
  isLoading: boolean
  isHovered: boolean
  hint: string
  isLoadingHint: boolean
  activeTab: string
  selectedProblem: Problem | null
  error: string | null
}

type Action =
  | { type: 'SET_CODE'; payload: string }
  | { type: 'SET_LANGUAGE'; payload: string }
  | { type: 'SET_OUTPUT'; payload: string }
  | { type: 'SET_IS_LOADING'; payload: boolean }
  | { type: 'SET_IS_HOVERED'; payload: boolean }
  | { type: 'SET_HINT'; payload: string }
  | { type: 'SET_IS_LOADING_HINT'; payload: boolean }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'SET_SELECTED_PROBLEM'; payload: Problem | null }
  | { type: 'SET_ERROR'; payload: string | null }

const initialState: State = {
  code: defaultJavaCode,
  language: 'java',
  output: '',
  isLoading: false,
  isHovered: false,
  hint: '',
  isLoadingHint: false,
  activeTab: 'description',
  selectedProblem: null,
  error: null,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CODE':
      return { ...state, code: action.payload }
    case 'SET_LANGUAGE':
      return { ...state, language: action.payload }
    case 'SET_OUTPUT':
      return { ...state, output: action.payload }
    case 'SET_IS_LOADING':
      return { ...state, isLoading: action.payload }
    case 'SET_IS_HOVERED':
      return { ...state, isHovered: action.payload }
    case 'SET_HINT':
      return { ...state, hint: action.payload }
    case 'SET_IS_LOADING_HINT':
      return { ...state, isLoadingHint: action.payload }
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload }
    case 'SET_SELECTED_PROBLEM':
      return { ...state, selectedProblem: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    default:
      return state
  }
}

async function fetchProblems() {
  const response = await fetch('/api/problems')
  if (!response.ok) {
    throw new Error('Failed to fetch problems')
  }
  return response.json()
}

export default function PracticeContainer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [state, dispatch] = useReducer(reducer, initialState)

  const { data: problems = [], isLoading: isLoadingProblems } = useQuery({
    queryKey: ['problems'],
    queryFn: fetchProblems,
  })

  const handleCodeChange = useCallback((value: string) => {
    dispatch({ type: 'SET_CODE', payload: value })
  }, [])

  const handleLanguageChange = useCallback(
    (value: string) => {
      dispatch({ type: 'SET_LANGUAGE', payload: value })
      dispatch({
        type: 'SET_CODE',
        payload: state.selectedProblem?.codeTemplates[value] || getDefaultCode(value),
      })
    },
    [state.selectedProblem],
  )

  const handleExecuteCode = useCallback(
    async (currentCode?: string) => {
      dispatch({ type: 'SET_IS_LOADING', payload: true })
      dispatch({ type: 'SET_OUTPUT', payload: '' })
      dispatch({ type: 'SET_ERROR', payload: null })
      try {
        const codeToExecute = currentCode ?? state.code
        const response = await fetch('/api/executions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: codeToExecute, language: state.language }),
        })
        if (!response.ok) {
          throw new Error('Execution failed')
        }
        if (!response.body) {
          throw new Error('ReadableStream not supported.')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let result = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          result += chunk
          dispatch({ type: 'SET_OUTPUT', payload: result })
        }
      } catch (error) {
        console.error('Execution error:', error)
        dispatch({ type: 'SET_ERROR', payload: 'An error occurred while executing the code.' })
        dispatch({ type: 'SET_OUTPUT', payload: '' })
      } finally {
        dispatch({ type: 'SET_IS_LOADING', payload: false })
      }
    },
    [state.code, state.language],
  )

  const handleHint = useCallback(async () => {
    if (state.isLoadingHint) return
    dispatch({ type: 'SET_IS_LOADING_HINT', payload: true })
    dispatch({ type: 'SET_HINT', payload: '' })
    try {
      const response = await fetch('/api/hints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: state.code,
          problem: state.selectedProblem?.description,
          language: state.language,
        }),
      })
      const data = await response.json()
      dispatch({ type: 'SET_HINT', payload: data.hint })
    } catch (error) {
      console.error('Error fetching hint:', error)
      dispatch({ type: 'SET_HINT', payload: 'Failed to fetch hint. Please try again.' })
    } finally {
      dispatch({ type: 'SET_IS_LOADING_HINT', payload: false })
    }
  }, [state.code, state.isLoadingHint, state.language, state.selectedProblem?.description])

  useEffect(() => {
    const problemId = searchParams.get('problemId')
    if (problems.length > 0) {
      const problem = problemId ? problems.find((p: Problem) => p.id === problemId) || problems[0] : problems[0]

      dispatch({ type: 'SET_SELECTED_PROBLEM', payload: problem })
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'description' })
      dispatch({
        type: 'SET_CODE',
        payload: problem.codeTemplates[state.language] || getDefaultCode(state.language),
      })
    }
  }, [problems, searchParams, state.language])

  const handleProblemChange = useCallback(
    (problem: Problem) => {
      dispatch({ type: 'SET_SELECTED_PROBLEM', payload: problem })
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'description' })
      dispatch({
        type: 'SET_CODE',
        payload: problem.codeTemplates[state.language] || getDefaultCode(state.language),
      })
      router.push(`/practice?problemId=${problem.id}`, { scroll: false })
    },
    [router, state.language],
  )

  const onHoverStart = useCallback(() => {
    dispatch({ type: 'SET_IS_HOVERED', payload: true })
  }, [])

  const onHoverEnd = useCallback(() => {
    dispatch({ type: 'SET_IS_HOVERED', payload: false })
  }, [])

  const onActiveTabChange = useCallback((tab: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tab })
  }, [])

  return (
    <PracticeView
      {...state}
      problems={problems}
      isLoadingProblems={isLoadingProblems}
      onCodeChange={handleCodeChange}
      onLanguageChange={handleLanguageChange}
      onExecuteCode={handleExecuteCode}
      onHint={handleHint}
      onProblemChange={handleProblemChange}
      onHoverStart={onHoverStart}
      onHoverEnd={onHoverEnd}
      onActiveTabChange={onActiveTabChange}
    />
  )
}

function getDefaultCode(language: string): string {
  switch (language) {
    case 'java':
      return defaultJavaCode
    case 'typescript':
      return defaultTypeScriptCode
    case 'javascript':
      return defaultJavaScriptCode
    case 'python':
      return defaultPythonCode
    default:
      return ''
  }
}
