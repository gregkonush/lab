import LogRocket from '@/components/logrocket'
import { ThreeScene } from '@/components/three'


export default async function Home() {
  return (
    <div className="flex min-w-full min-h-[calc(100vh-10rem)] flex-col items-center justify-center prose dark:prose-invert">
      <h1 className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-500 to-sky-500 animate-gradient-x">AI Interview Coach</h1>
      <p className="text-left">Tech interview practice made easy.</p>
      <div className="w-64 h-64 mt-8">
        <ThreeScene />
      </div>
      <LogRocket event="page_view" data={{ page: 'home' }} />
    </div>
  )
}

