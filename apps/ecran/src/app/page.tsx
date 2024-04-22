export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center text-2xl px-5 py-4 border-b border-gray-800 uppercase">
        proompteng<span className="text-indigo-400">▪</span>ai
      </header>
      <div className="mt-40 flex flex-col items-center justify-center space-y-2">
        <div>sign up for waitlist</div>
        <form>
          <input className="mx-2 rounded px-2 py-0.5 text-indigo-800/80" type="email" placeholder="your email" />
          <button className="bg-indigo-500 text-white px-2 py-0.5 rounded" type="submit">
            sign up
          </button>
        </form>
      </div>
    </main>
  )
}
