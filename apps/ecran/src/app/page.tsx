'use client'

import * as React from 'react'
import LogRocket from 'logrocket'

if (typeof window !== 'undefined') {
  LogRocket.init('c7fjts/proomptengai')
}

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
    <div className="flex min-w-full min-h-[calc(100vh-10rem)] flex-col items-center justify-center prose dark:prose-invert">
      <h1 className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-sky-500">AI Leetcode Coach</h1>
      <p className="text-left">Tech interview practice made easy.</p>
    </div>
  )
}
