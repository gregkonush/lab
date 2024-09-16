'use client'

import { useInterval } from 'interval-hooks'
import { useEffect, useState } from 'react'

export function RefreshCache({ check }: { check: () => Promise<void> }) {
  const [shouldRun, setShouldRun] = useState(typeof document !== 'undefined' && document.hasFocus())

  useEffect(() => {
    const onFocus = () => {
      check()
      setShouldRun(true)
    }
    const onBlur = () => setShouldRun(false)

    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [check])

  useInterval(check, shouldRun ? 1000 : null)

  return null
}
