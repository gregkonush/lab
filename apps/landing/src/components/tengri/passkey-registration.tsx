'use client'

import { useState } from 'react'
import { Button } from '@proompteng/design/ui'
import { startTengriSignIn } from '@/lib/tengri/auth-client'

type RegistrationState = { status: 'idle' | 'redirecting' } | { status: 'error'; message: string }

export function PasskeyRegistration() {
  const [state, setState] = useState<RegistrationState>({ status: 'idle' })
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={state.status === 'redirecting'}
        aria-busy={state.status === 'redirecting'}
        onClick={() => {
          setState({ status: 'redirecting' })
          void startTengriSignIn('add-passkey').catch((cause: unknown) => {
            setState({
              status: 'error',
              message: cause instanceof Error ? cause.message : 'Passkey setup could not start. Try again.',
            })
          })
        }}
      >
        {state.status === 'redirecting' ? 'Opening passkey setup…' : 'Add passkey'}
      </Button>
      <p className="text-xs leading-5 text-zinc-400">
        Verify with your current passkey, then save another in 1Password or on your phone. You can also choose a phone
        from your computer’s passkey dialog.
      </p>
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-red-300">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
