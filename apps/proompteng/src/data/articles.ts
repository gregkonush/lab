interface NewsItem {
  id: number
  title: string
  description: string
  date: string
  category: 'AI' | 'Tech' | 'Prompt Engineering'
  readTime: string
}

export const newsItems: NewsItem[] = [
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
