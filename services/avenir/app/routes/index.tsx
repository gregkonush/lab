import './index.css'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { memo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, TrendingUp, Database, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const features = [
  {
    title: 'Real-time Data',
    description: 'Access up-to-the-minute startup metrics and performance indicators',
    icon: TrendingUp,
  },
  {
    title: 'Comprehensive Database',
    description: 'Over 50,000 startups with detailed financial and operational insights',
    icon: Database,
  },
  {
    title: 'Expert Analysis',
    description: 'In-depth reports from industry experts and market analysts',
    icon: Users,
  },
]

const FeatureCard = memo(
  ({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) => (
    <Card className="p-6 bg-zinc-900/50 border-zinc-800 transition-all duration-300 hover:scale-105">
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-lg bg-indigo-500/10">
          <Icon className="w-6 h-6 text-indigo-500" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-semibold text-zinc-100">{title}</h3>
          <p className="mt-2 text-sm text-zinc-400">{description}</p>
        </div>
      </div>
    </Card>
  ),
)

FeatureCard.displayName = 'FeatureCard'

export const Route = createFileRoute('/')({
  component: Home,
})

export default function Home() {
  const router = useRouter()

  const handleGetStarted = useCallback(() => {
    router.navigate({ to: '/signup' })
  }, [router])

  return (
    <main className="min-h-screen antialiased bg-zinc-900">
      <div className="container px-4 py-24 mx-auto max-w-7xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
            50,000+ startups analyzed
          </Badge>

          <h1 className="mt-6 text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 via-indigo-600 to-indigo-800 sm:text-6xl leading-[1.2] pb-2">
            Your Gateway to Startup Intelligence
          </h1>

          <p className="mt-6 text-lg leading-8 text-zinc-400 max-w-2xl mx-auto">
            Access comprehensive data, insights, and analysis on the most promising startups. Make informed decisions
            with our curated database of startup intelligence.
          </p>

          <div className="mt-10 flex items-center justify-center gap-6">
            <Button size="lg" onClick={handleGetStarted} className="bg-indigo-600 hover:bg-indigo-700">
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>

            <Button size="lg" variant="outline" className="border-zinc-700 hover:bg-zinc-200 hover:text-zinc-900">
              Learn More
            </Button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-24 grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </motion.div>
      </div>
    </main>
  )
}
