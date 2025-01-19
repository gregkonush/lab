export function InfinityBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none transition-[opacity] duration-200 group-hover:opacity-[0.15]"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      viewBox="0 0 100 40"
    >
      <title>Decorative 00 Background</title>
      <defs>
        <linearGradient id="circleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgb(139 92 246)" />
          <stop offset="100%" stopColor="rgb(99 102 241)" />
        </linearGradient>
      </defs>
      <g className="origin-[50%_20px] transition-transform duration-700 group-hover:rotate-[360deg]">
        <circle
          cx="35"
          cy="20"
          r="8"
          fill="none"
          stroke="url(#circleGradient)"
          strokeWidth="3"
          className="transition-colors duration-200"
        />
        <circle
          cx="65"
          cy="20"
          r="8"
          fill="none"
          stroke="url(#circleGradient)"
          strokeWidth="3"
          className="transition-colors duration-200"
        />
      </g>
    </svg>
  )
}
