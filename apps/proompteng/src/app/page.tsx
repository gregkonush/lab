import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfinityBackground } from '@/components/background'
import { cn } from '@/lib/utils'
import { newsItems } from '@/data/articles'

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
              className="relative flex flex-col h-72 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer bg-slate-950/80 hover:bg-gradient-to-br hover:from-slate-950 hover:to-indigo-900/10 overflow-hidden group"
            >
              <InfinityBackground />
              <div className="relative z-10 flex flex-col h-full">
                <CardHeader className="flex-none">
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={cn('select-none px-3 py-1 rounded-full text-xs font-semibold', {
                        'bg-indigo-950/80 text-indigo-200 ring-1 ring-indigo-800/30': item.category === 'AI',
                        'bg-emerald-950/80 text-emerald-200 ring-1 ring-emerald-800/30': item.category === 'Tech',
                        'bg-violet-950/80 text-violet-200 ring-1 ring-violet-800/30':
                          item.category === 'Prompt Engineering',
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
