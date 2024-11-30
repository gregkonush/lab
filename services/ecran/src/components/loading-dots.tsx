import { motion } from 'framer-motion'

export function LoadingDots() {
  return (
    <div className="flex min-h-6 items-center justify-center space-x-1">
      <motion.span
        className="h-2 w-2 rounded-full bg-current"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
      <motion.span
        className="h-2 w-2 rounded-full bg-current"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.div
        className="h-2 w-2 rounded-full bg-current"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.4 }}
      />
    </div>
  )
}
