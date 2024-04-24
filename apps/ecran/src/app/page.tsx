'use client'

import * as React from 'react'

export default function Home() {
  const [email, setEmail] = React.useState('')
  const [signedUp, setSignedUp] = React.useState(false)

  React.useEffect(() => {
    const waitlistData = localStorage.getItem('proompteng-waitlist')
    if (waitlistData) {
      setSignedUp(JSON.parse(waitlistData).signedUp)
    }
  }, [])

  const handleOnChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await fetch('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    })

    setSignedUp(true)

    localStorage.setItem('proompteng-waitlist', JSON.stringify({ signedUp: true }))
  }

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center text-2xl px-5 py-4 border-b border-gray-800 uppercase">
        proompteng<span className="text-indigo-400">▪</span>ai
      </header>
      <div className="mt-40 flex flex-col items-center justify-center space-y-2">
        {signedUp ? (
          <div>Thanks, we will let you when app is available</div>
        ) : (
          <>
            <div>sign up for waitlist</div>
            <form onSubmit={handleSubmit}>
              <input
                className="mx-2 rounded px-2 py-0.5 text-indigo-800/80"
                type="email"
                placeholder="your email"
                value={email}
                onChange={handleOnChange}
              />
              <button className="bg-indigo-500 text-white px-2 py-0.5 rounded" type="submit">
                sign up
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
