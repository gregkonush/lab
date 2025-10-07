import { SOCIAL_PROOF } from '@/app/config'

export default function SocialProof() {
  return (
    <section
      aria-labelledby="social-proof-heading"
      className="rounded-3xl border bg-card/60 px-6 py-10 shadow-sm backdrop-blur sm:px-10"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">trusted by launch partners</p>
          <h2 id="social-proof-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            Designed with teams operating regulated workloads
          </h2>
        </div>
        <p className="max-w-sm text-sm text-muted-foreground sm:text-right">
          From biotech to fintech, proompteng keeps governance and velocity in the same workflow.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SOCIAL_PROOF.map(({ name, tagline }) => (
          <div
            key={name}
            className="group relative overflow-hidden rounded-2xl border bg-secondary/30 p-5 transition-colors hover:border-ring/40 hover:bg-secondary/50"
          >
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-ring/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <p className="text-sm font-semibold text-foreground">{name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tagline}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
