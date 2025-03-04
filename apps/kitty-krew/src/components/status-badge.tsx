import React from 'react'
import { cva } from 'class-variance-authority'

const statusVariants = {
  Running: 'bg-green-700 text-green-100',
  Pending: 'bg-yellow-700 text-yellow-100',
  Failed: 'bg-red-700 text-red-100',
  Succeeded: 'bg-blue-700 text-blue-100',
  CrashLoopBackOff: 'bg-red-700 text-red-100',
  Terminating: 'bg-orange-700 text-orange-100',
  Evicted: 'bg-purple-700 text-purple-100',
  default: 'bg-zinc-700 text-zinc-100',
}

const statusBadgeVariants = cva('px-2 py-0.5 rounded-full text-xs font-medium', {
  variants: {
    status: statusVariants,
  },
  defaultVariants: {
    status: 'default',
  },
})

type StatusVariant = keyof typeof statusVariants

interface StatusBadgeProps {
  status?: string
}

export const StatusBadge = React.memo(({ status }: StatusBadgeProps) => {
  const getVariantStatus = (status?: string): StatusVariant => {
    if (!status) return 'default'
    return (status in statusVariants ? status : 'default') as StatusVariant
  }

  return <span className={statusBadgeVariants({ status: getVariantStatus(status) })}>{status || 'Unknown'}</span>
})
