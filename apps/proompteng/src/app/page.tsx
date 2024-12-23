import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function InfinityBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none transition-[opacity] duration-200 group-hover:opacity-[0.15]"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      viewBox="0 0 100 40"
    >
      <title>Decorative 00 Background</title>
      <defs>
        <linearGradient id="circleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgb(139 92 246)" />
          <stop offset="100%" stopColor="rgb(99 102 241)" />
        </linearGradient>
      </defs>
      <g className="origin-[50%_20px] transition-transform duration-700 group-hover:rotate-[360deg]">
        <circle
          cx="35"
          cy="20"
          r="8"
          fill="none"
          stroke="url(#circleGradient)"
          strokeWidth="3"
          className="transition-colors duration-200"
        />
        <circle
          cx="65"
          cy="20"
          r="8"
          fill="none"
          stroke="url(#circleGradient)"
          strokeWidth="3"
          className="transition-colors duration-200"
        />
      </g>
    </svg>
  )
}

interface NewsItem {
  id: number
  title: string
  description: string
  date: string
  category: 'AI' | 'Tech' | 'Prompt Engineering'
  readTime: string
}

const newsItems: NewsItem[] = [
  {
    id: 1,
    title: 'OpenAI Introduces GPT-4 Turbo with Enhanced Context Window',
    description:
      'The latest model features a 128k context window and improved performance across various tasks, particularly in code generation and mathematical reasoning.',
    date: '2024-03-15',
    category: 'AI',
    readTime: '4 min read',
  },
  {
    id: 2,
    title: 'New Framework Revolutionizes Prompt Engineering Workflows',
    description:
      'Researchers develop a systematic approach to prompt engineering that increases success rates by 47% across various language models.',
    date: '2024-03-14',
    category: 'Prompt Engineering',
    readTime: '6 min read',
  },
  {
    id: 3,
    title: "Apple's Vision Pro Transforms Spatial Computing",
    description:
      'Early adopters report unprecedented experiences with spatial computing, as developers rush to create innovative applications for the platform.',
    date: '2024-03-13',
    category: 'Tech',
    readTime: '5 min read',
  },
  {
    id: 4,
    title: 'Chain-of-Thought Prompting Breakthrough',
    description:
      'New research shows that carefully structured chain-of-thought prompts can improve AI reasoning capabilities by up to 32% in complex tasks.',
    date: '2024-03-12',
    category: 'Prompt Engineering',
    readTime: '7 min read',
  },
  {
    id: 5,
    title: "Anthropic's Claude 3 Sets New Benchmarks",
    description:
      'The latest model demonstrates unprecedented capabilities in reasoning, coding, and mathematical problem-solving, challenging existing AI boundaries.',
    date: '2024-03-11',
    category: 'AI',
    readTime: '5 min read',
  },
  {
    id: 6,
    title: 'Quantum Computing Milestone Achieved',
    description:
      'Scientists successfully demonstrate error-free quantum operations at scale, bringing practical quantum computing one step closer to reality.',
    date: '2024-03-10',
    category: 'Tech',
    readTime: '8 min read',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen w-full mx-auto flex flex-col items-center">
      <div className="container px-4 py-10 max-w-7xl">
        <div className="flex justify-center space-x-12 mb-10">
          <div className="size-16 rounded-full border-indigo-400 border-8" />
          <div className="size-16 rounded-full border-indigo-400 border-8 scale-125" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mx-auto max-w-[1400px]">
          {newsItems.map((item) => (
            <Card
              key={item.id}
              className="relative flex flex-col h-72 hover:shadow-lg hover:scale-[1.01] transition-all duration-200 cursor-pointer bg-slate-950/80 hover:bg-gradient-to-br hover:from-slate-950 hover:to-indigo-900/10 overflow-hidden group"
            >
              <InfinityBackground />
              <div className="relative z-10 flex flex-col h-full">
                <CardHeader className="flex-none">
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={cn('select-none px-3 py-1 rounded-full text-xs font-semibold', {
                        'bg-indigo-950/80 text-indigo-200 ring-1 ring-indigo-800/30': item.category === 'AI',
                        'bg-emerald-950/80 text-emerald-200 ring-1 ring-emerald-800/30': item.category === 'Tech',
                        'bg-violet-950/80 text-violet-200 ring-1 ring-violet-800/30': item.category === 'Prompt Engineering',
                      })}
                    >
                      {item.category}
                    </span>
                    <span className="text-sm text-slate-400">{item.readTime}</span>
                  </div>
                  <CardTitle className="line-clamp-2 min-h-[48px]">{item.title}</CardTitle>
                  <CardDescription className="text-sm text-slate-400">
                    {new Date(item.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="text-sm text-slate-400 line-clamp-3">{item.description}</p>
                </CardContent>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
