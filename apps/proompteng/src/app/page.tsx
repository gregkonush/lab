import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
        <h1 className="text-4xl font-bold mb-12 text-center">Latest Tech & AI News</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mx-auto max-w-[1400px]">
          {newsItems.map((item) => (
            <Card
              key={item.id}
              className="flex flex-col h-72 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer bg-slate-950 hover:bg-gradient-to-br hover:from-slate-950 hover:to-indigo-950"
            >
              <CardHeader className="flex-none">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={cn('select-none px-3 py-1 rounded-full text-xs font-semibold', {
                      'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-700/10': item.category === 'AI',
                      'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-700/10': item.category === 'Tech',
                      'bg-violet-100 text-violet-700 ring-1 ring-violet-700/10': item.category === 'Prompt Engineering',
                    })}
                  >
                    {item.category}
                  </span>
                  <span className="text-sm text-muted-foreground">{item.readTime}</span>
                </div>
                <CardTitle className="line-clamp-2 min-h-[48px]">{item.title}</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {new Date(item.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-sm text-muted-foreground line-clamp-3">{item.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
