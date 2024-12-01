import React, { useMemo, useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import Editor from '@/components/editor'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { LoadingDots } from '@/components/loading-dots'
import { HintSkeleton } from '@/components/hint-skeleton'
import { Menu } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Problem } from '@/app/problems/types'

const ITEM_HEIGHT = 42 // Height of each item including separator

const ProblemItem = React.memo(
  ({ problem, isSelected, onClick }: { problem: Problem; isSelected: boolean; onClick: () => void }) => (
    <div className="py-1">
      <Button
        variant="ghost"
        className={cn(
          'h-auto w-full justify-between px-2 py-1.5 text-left hover:bg-zinc-800',
          isSelected && 'bg-zinc-800',
        )}
        onClick={onClick}
      >
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block max-w-[250px] truncate">{problem.title}</span>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[300px]">
              <p>{problem.title}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Badge
          variant="outline"
          className={cn(
            'ml-2 shrink-0 font-medium',
            problem.difficulty === 'easy' && 'border-green-500/30 text-green-500',
            problem.difficulty === 'medium' && 'border-yellow-500/30 text-yellow-500',
            problem.difficulty === 'hard' && 'border-red-500/30 text-red-500',
          )}
        >
          {problem.difficulty}
        </Badge>
      </Button>
      <Separator className="mt-1" />
    </div>
  ),
)
ProblemItem.displayName = 'ProblemItem'

const VirtualizedProblemsList = React.memo(
  ({
    problems,
    selectedProblem,
    onProblemChange,
    onClose,
  }: {
    problems: Problem[]
    selectedProblem: Problem | null
    onProblemChange: (problem: Problem) => void
    onClose: () => void
  }) => {
    const parentRef = React.useRef<HTMLDivElement>(null)

    const virtualizer = useVirtualizer({
      count: problems.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => ITEM_HEIGHT,
      overscan: 5,
    })

    const handleProblemSelect = useCallback(
      (problem: Problem) => {
        onProblemChange(problem)
        onClose()
      },
      [onProblemChange, onClose],
    )

    return (
      <div ref={parentRef} className="h-[calc(100vh-8rem)] overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const problem = problems[virtualItem.index]
            if (!problem) return null

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className="px-2"
              >
                <ProblemItem
                  problem={problem}
                  isSelected={selectedProblem?.id === problem.id}
                  onClick={() => handleProblemSelect(problem)}
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  },
)
VirtualizedProblemsList.displayName = 'VirtualizedProblemsList'

type PracticeViewProps = {
  code: string
  language: string
  output: string
  isLoading: boolean
  isHovered: boolean
  hint: string
  isLoadingHint: boolean
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

export default function PracticeView({
  code,
  language,
  output,
  isLoading,
  isHovered,
  hint,
  isLoadingHint,
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
}: PracticeViewProps) {
  const [isOpen, setIsOpen] = useState(false)

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

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <div className="container mx-auto px-2">
      <div className="mx-auto max-w-screen-xl space-y-3">
        <div className="flex items-center">
          <div className="flex flex-1 flex-row items-center space-x-3">
            <motion.div
              whileTap={{ scale: isLoading ? 1 : 0.975 }}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
              tabIndex={-1}
              className={cn(isLoading && 'cursor-not-allowed opacity-50')}
            >
              <Button
                onClick={() => handleExecuteCode()}
                disabled={isLoading}
                className={cn(
                  'disabled:cursor-not-allowed disabled:bg-zinc-600 disabled:text-zinc-400 disabled:opacity-50',
                  'rounded bg-indigo-600 px-4 py-1 text-zinc-200',
                  'hover:bg-zinc-200 hover:text-indigo-600',
                  'flex items-center justify-center transition-all duration-300',
                  'min-w-20 text-center ring-zinc-900',
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
                    'min-w-20 rounded bg-inherit px-4 py-1',
                    'shadow-dark-sm ring-2 ring-indigo-500/50',
                    'disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-400',
                    isLoadingHint && 'cursor-not-allowed opacity-50',
                  )}
                  onClick={handleHint}
                >
                  {isLoadingHint ? <LoadingDots /> : 'Hint'}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="border-none bg-transparent p-0">
                <motion.div
                  className={cn(
                    'w-80 border-2 border-indigo-500/50 bg-stone-900 p-4',
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
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0">
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Open problem list</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[400px] p-0">
                <div className="flex h-full flex-col">
                  <div className="border-b border-zinc-800 px-6 py-4">
                    <SheetTitle className="text-lg font-semibold text-zinc-100">Problems</SheetTitle>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    {isLoadingProblems ? (
                      <div className="flex h-full items-center justify-center">
                        <LoadingDots />
                      </div>
                    ) : (
                      <VirtualizedProblemsList
                        problems={problems}
                        selectedProblem={selectedProblem}
                        onProblemChange={onProblemChange}
                        onClose={handleClose}
                      />
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <h1 className="px-4 text-2xl font-bold">Practice</h1>
          <div className="flex flex-1 flex-row items-center justify-end space-x-4">
            <label className="text-sm font-semibold" htmlFor="language-select">
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
        <div className="flex min-h-[calc(100vh-30rem)] flex-row space-x-3">
          <div className="h-auto w-1/2">
            <Editor code={code} onCodeChange={onCodeChange} language={language} onExecute={handleExecuteCode} />
          </div>
          <div className="w-1/2 overflow-hidden rounded-md border border-zinc-900 bg-zinc-800 text-sm">
            <div className="flex h-full flex-col">
              {selectedProblem && (
                <div className="shrink-0 px-4 py-3">
                  <h2 className="text-lg font-semibold text-zinc-100">{selectedProblem.title}</h2>
                  <Separator className="my-3 bg-zinc-700" />
                </div>
              )}
              <ScrollArea className="max-h-[calc(100vh-30rem)] flex-1">
                <div className="px-4 pb-4">
                  {selectedProblem?.descriptionHtml ? (
                    <div
                      className="prose prose-invert prose-pre:overflow-x-auto prose-pre:whitespace-pre-wrap"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
                      dangerouslySetInnerHTML={{ __html: selectedProblem.descriptionHtml }}
                    />
                  ) : (
                    <div className="prose prose-sm prose-invert prose-pre:overflow-x-auto prose-pre:whitespace-pre-wrap">
                      {description}
                    </div>
                  )}
                </div>
                <ScrollBar />
              </ScrollArea>
            </div>
          </div>
        </div>

        <div
          className={cn([
            'min-h-40 space-y-2 rounded-md border border-zinc-900 p-4',
            output.toLowerCase().includes('error') || output.toLowerCase().includes('exception')
              ? 'bg-red-800 text-red-100'
              : 'bg-zinc-800 text-zinc-100',
          ])}
        >
          {isLoading ? (
            <p className="text-muted-foreground">Executing code...</p>
          ) : output ? (
            <pre className={cn(['w-full overflow-x-auto rounded-md text-sm'])}>{output}</pre>
          ) : (
            <p className="text-muted-foreground">Click execute to see the output.</p>
          )}
        </div>
      </div>
    </div>
  )
}
