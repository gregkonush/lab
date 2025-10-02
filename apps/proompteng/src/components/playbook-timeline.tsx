import { PLAYBOOK } from '@/app/config'

export default function PlaybookTimeline() {
  return (
    <section
      id="playbook"
      aria-labelledby="playbook-heading"
      className="rounded-3xl border bg-card/70 px-6 py-12 shadow-sm backdrop-blur sm:px-10"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">launch playbook</p>
        <h2 id="playbook-heading" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          From prototype to governed production in one week
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Drop in proompteng where it fits today — then scale to full governance without rearchitecting.
        </p>
      </div>

      <div className="relative mx-auto mt-10 max-w-3xl">
        <span aria-hidden className="absolute left-4 top-0 h-full w-px bg-border/60" />
        <ol className="space-y-10">
          {PLAYBOOK.map(({ title, description, timeframe, result }) => (
            <li key={title} className="relative list-none pl-12">
              <span className="absolute left-4 top-5 flex size-3 -translate-x-1/2 items-center justify-center rounded-full border-2 border-primary bg-primary" />
              <div className="rounded-2xl border bg-secondary/30 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{timeframe}</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
                <p className="mt-3 text-sm font-medium text-primary">outcome: {result}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
