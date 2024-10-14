import { motion } from 'framer-motion'

export function LoadingDots() {
  return (
    <div className="flex items-center justify-center space-x-1 min-h-6">
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.4 }}
      />
    </div>
  )
}
