'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import Editor from '@/components/editor'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'
import { Skeleton } from '@/components/ui/skeleton'

const defaultJavaCode = `
public String greet(String name) {
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

function LoadingDots() {
  return (
    <div className="flex items-center justify-center space-x-1 min-h-6">
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.4 }}
      />
    </div>
  )
}

function HintSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

const sparkleVariants = {
  initial: { borderColor: 'rgba(99, 102, 241, 0.2)' },
  animate: {
    borderColor: [
      'rgba(99, 102, 241, 0.2)',
      'rgba(99, 102, 241, 0.8)',
      'rgba(99, 102, 241, 0.2)',
      'rgba(99, 102, 241, 0.8)',
      'rgba(99, 102, 241, 0.2)',
    ],
    transition: {
      duration: 7,
      repeat: Number.POSITIVE_INFINITY,
      ease: 'easeInOut',
    },
  },
}

export default function PracticePage() {
  const [code, setCode] = useState(defaultJavaCode)
  const [language, setLanguage] = useState('java')
  const [output, setOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [hint, setHint] = useState('')
  const [isLoadingHint, setIsLoadingHint] = useState(false)

  const handleCodeChange = (value: string) => {
    setCode(value)
  }

  const handleLanguageChange = (value: string) => {
    setLanguage(value)
    setCode(getDefaultCode(value))
  }

  const getDefaultCode = (language: string) => {
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

  const handleExecuteCode = useCallback(
    async (currentCode?: string) => {
      setIsLoading(true)
      setOutput('')
      try {
        const codeToExecute = currentCode ?? code
        const response = await fetch('/api/executions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: codeToExecute, language }),
        })
        if (!response.body) {
          throw new Error('ReadableStream not supported.')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let done = false

        while (!done) {
          const { value, done: doneReading } = await reader.read()
          done = doneReading
          if (value) {
            const chunk = decoder.decode(value)
            setOutput((prevOutput) => prevOutput + chunk)
          }
        }
      } catch (error) {
        console.error('Execution error:', error)
        setOutput('An error occurred while executing the code.')
      } finally {
        setIsLoading(false)
      }
    },
    [code, language],
  )

  const handleHint = useCallback(async () => {
    if (isLoadingHint) return
    setIsLoadingHint(true)
    setHint('')
    try {
      const response = await fetch('/api/hints', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, problem: defaultProblem, language }),
      })
      const data = await response.json()
      setHint(data.hint)
    } catch (error) {
      console.error('Error fetching hint:', error)
      setHint('Failed to fetch hint. Please try again.')
    } finally {
      setIsLoadingHint(false)
    }
  }, [code, isLoadingHint, language])

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="max-w-screen-xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Practice</h1>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex flex-row space-x-2 items-center">
            <motion.div
              whileTap={{ scale: isLoading ? 1 : 0.975 }}
              onHoverStart={() => setIsHovered(true)}
              onHoverEnd={() => setIsHovered(false)}
              tabIndex={-1}
              className={cn(isLoading && 'opacity-50 cursor-not-allowed')}
            >
              <Button
                onClick={() => handleExecuteCode()}
                disabled={isLoading}
                className={cn(
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-600 disabled:text-zinc-400',
                  'rounded py-1 px-4 bg-indigo-600 text-zinc-200',
                  'hover:bg-zinc-200 hover:text-indigo-600 ',
                  'transition-all duration-300 flex items-center justify-center',
                  'text-center min-w-20 ring-zinc-900',
                  'shadow-dark-sm ring-1 ring-indigo-400',
                )}
              >
                {isLoading ? <LoadingDots /> : isHovered ? '|>' : 'Run'}
              </Button>
            </motion.div>
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'py-1 px-4 rounded min-w-20 bg-inherit',
                    'ring-2 ring-indigo-500/50 shadow-dark-sm',
                    'disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-400',
                    isLoadingHint && 'opacity-50 cursor-not-allowed',
                  )}
                  onClick={handleHint}
                >
                  {isLoadingHint ? <LoadingDots /> : 'Hint'}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="p-0 bg-transparent border-none">
                <motion.div
                  className={cn(
                    'w-80 p-4 bg-stone-900 border-2 border-indigo-500/50',
                    'relative overflow-hidden rounded-md',
                  )}
                  variants={sparkleVariants}
                  initial="initial"
                  animate="animate"
                >
                  <div className="relative z-10">
                    {isLoadingHint ? (
                      <HintSkeleton />
                    ) : hint ? (
                      <p className="text-sm text-zinc-200">{hint}</p>
                    ) : (
                      <p className="text-sm text-zinc-400">Click to load a hint</p>
                    )}
                  </div>
                </motion.div>
              </HoverCardContent>
            </HoverCard>
          </div>
          <div className="space-y-2 flex flex-row items-center">
            <label className="mr-4 font-semibold text-sm pt-1.5" htmlFor="language-select">
              Language
            </label>
            <Select value={language} onValueChange={handleLanguageChange} name="language-select">
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="java">Java</SelectItem>
                <SelectItem value="typescript">TypeScript</SelectItem>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="python">Python</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-row space-x-4">
          <div className="basis-1/2 h-auto shrink-0">
            <Editor code={code} onCodeChange={handleCodeChange} language={language} onExecute={handleExecuteCode} />
          </div>
          <div className="basis-1/2 border border-zinc-900 rounded-md p-4 bg-zinc-800 text-sm whitespace-pre-wrap">
            {defaultProblem}
          </div>
        </div>

        <div
          className={cn([
            'border border-zinc-900 rounded-md p-4 space-y-2 min-h-40',
            output.toLowerCase().includes('error') || output.toLowerCase().includes('exception')
              ? 'bg-red-800 text-red-100'
              : 'bg-zinc-800 text-zinc-100',
          ])}
        >
          {isLoading ? (
            <p className="text-muted-foreground">Executing code...</p>
          ) : output ? (
            <pre className={cn(['rounded-md w-full overflow-x-auto text-sm'])}>{output}</pre>
          ) : (
            <p className="text-muted-foreground">Click execute to see the output.</p>
          )}
        </div>
      </div>
    </div>
  )
}