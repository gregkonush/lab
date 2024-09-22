'use client'

import logrocket from 'logrocket'

if (typeof window !== 'undefined') {
  logrocket.init('c7fjts/proomptengai')
}

interface LogRocketProps {
  event: string;
  data: any;
}

export default function LogRocket({ event, data }: LogRocketProps) {
  if (typeof window !== 'undefined') {
    logrocket.track(event, data)
  }
  return null
}
