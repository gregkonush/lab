import { ArrowRight } from 'lucide-react'
import { HERO, PRIMARY_CTA_HREF } from '@/app/config'
import { Button } from '@/components/ui/button'

export default function ClosingCta() {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border bg-gradient-to-br from-primary to-primary/70 px-6 py-14 shadow-lg sm:px-12">
      <div className="absolute inset-0 -z-[1] bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_transparent_55%)]" />
      <div className="mx-auto max-w-3xl text-center text-primary-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary-foreground/80">ready to launch</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Operate every AI agent with production confidence
        </h2>
        <p className="mt-3 text-sm text-primary-foreground/80">
          Deploy to your cloud, keep the governance you need, and keep iterating with the tools you love.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" variant="secondary">
            <a href={PRIMARY_CTA_HREF} target="_blank" rel="noopener noreferrer">
              {HERO.ctaLabel}
              <ArrowRight className="size-5" />
            </a>
          </Button>
          <Button asChild size="lg" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10">
            <a href={HERO.secondaryCtaHref}>{HERO.secondaryCtaLabel}</a>
          </Button>
        </div>
        <p className="mt-4 text-xs uppercase tracking-[0.2em] text-primary-foreground/70">{HERO.deRisk}</p>
      </div>
    </section>
  )
}
