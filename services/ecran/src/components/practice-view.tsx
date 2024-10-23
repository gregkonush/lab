import React, { useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Editor from '@/components/editor'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { LoadingDots } from '@/components/loading-dots'
import { HintSkeleton } from '@/components/hint-skeleton'
import type { Problem } from '@/app/problems/types'

type PracticeViewProps = {
  code: string
  language: string
  output: string
  isLoading: boolean
  isHovered: boolean
  hint: string
  isLoadingHint: boolean
  activeTab: string
  selectedProblem: Problem | null
  problems: Problem[]
  isLoadingProblems: boolean
  onCodeChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onExecuteCode: (currentCode?: string) => void
  onHint: () => void
  onProblemChange: (problem: Problem) => void
  onHoverStart: () => void
  onHoverEnd: () => void
  onActiveTabChange: (tab: string) => void
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

const ProblemsList = React.memo(
  ({
    problems,
    selectedProblem,
    onProblemChange,
  }: {
    problems: Problem[]
    selectedProblem: Problem | null
    onProblemChange: (problem: Problem) => void
  }) => {
    return (
      <ScrollArea className="h-[calc(100vh-35rem)] w-full">
        <div className="pr-4">
          <ul className="space-y-2 mt-2">
            {problems.map((problem: Problem, index: number) => (
              <li key={problem.id}>
                <Button
                  variant="ghost"
                  className={cn(
                    'w-full justify-start text-left hover:bg-zinc-700',
                    selectedProblem?.id === problem.id && 'bg-zinc-700',
                  )}
                  onClick={() => onProblemChange(problem)}
                >
                  {problem.title}
                </Button>
                {index < problems.length - 1 && <Separator className="mt-2 bg-zinc-700" />}
              </li>
            ))}
          </ul>
        </div>
        <ScrollBar orientation="vertical" className="w-2" />
      </ScrollArea>
    )
  },
)
ProblemsList.displayName = 'ProblemsList'

export default function PracticeView({
  code,
  language,
  output,
  isLoading,
  isHovered,
  hint,
  isLoadingHint,
  activeTab,
  selectedProblem,
  problems,
  isLoadingProblems,
  onCodeChange,
  onLanguageChange,
  onExecuteCode,
  onHint,
  onProblemChange,
  onHoverStart,
  onHoverEnd,
  onActiveTabChange,
}: PracticeViewProps) {
  const description = useMemo(() => {
    if (selectedProblem?.description) {
      return selectedProblem.description
    }
    if (selectedProblem?.descriptionHtml) {
      return selectedProblem.descriptionHtml
    }
    return ''
  }, [selectedProblem])

  const handleExecuteCode = useCallback(() => {
    onExecuteCode()
  }, [onExecuteCode])

  const handleHint = useCallback(() => {
    onHint()
  }, [onHint])

  return (
    <div className="container mx-auto px-2">
      <div className="max-w-screen-xl mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold -mt-2">Practice</h1>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex flex-row space-x-3 items-center">
            <motion.div
              whileTap={{ scale: isLoading ? 1 : 0.975 }}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
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
            <Select value={language} onValueChange={onLanguageChange} name="language-select">
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
        <div className="flex flex-row space-x-3 min-h-[calc(100vh-30rem)]">
          <div className="basis-1/2 h-auto shrink-0">
            <Editor code={code} onCodeChange={onCodeChange} language={language} onExecute={handleExecuteCode} />
          </div>
          <div className="basis-1/2 border border-zinc-900 rounded-md p-2 bg-zinc-800 text-sm">
            <Tabs value={activeTab} onValueChange={onActiveTabChange} className="w-full">
              <TabsList className="bg-zinc-700">
                <TabsTrigger value="description">Problem Description</TabsTrigger>
                <TabsTrigger value="select">Select Problem</TabsTrigger>
              </TabsList>
              <TabsContent value="description">
                <Separator className="bg-zinc-700" />
                <ScrollArea className="h-[calc(100vh-30rem)]">
                  <div className="px-2">
                    {selectedProblem?.descriptionHtml ? (
                      <div
                        className="prose prose-invert pr-4 pt-1"
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
                        dangerouslySetInnerHTML={{ __html: selectedProblem.descriptionHtml }}
                      />
                    ) : (
                      <div className="whitespace-pre-wrap prose prose-invert prose-sm pr-4 pt-1">{description}</div>
                    )}
                  </div>
                  <ScrollBar orientation="vertical" className="w-2" />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="select" className="flex-1">
                {isLoadingProblems ? (
                  <div className="flex justify-center items-center h-[calc(100vh-40rem)]">
                    <LoadingDots />
                  </div>
                ) : (
                  <ProblemsList
                    problems={problems}
                    selectedProblem={selectedProblem}
                    onProblemChange={onProblemChange}
                  />
                )}
              </TabsContent>
            </Tabs>
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
