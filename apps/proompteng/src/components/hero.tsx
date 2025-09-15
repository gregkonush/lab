import { ArrowRight } from "lucide-react";
import { HERO, PRIMARY_CTA_HREF } from "@/app/config";
import { Button } from "@/components/ui/button";

export default function Hero() {
  const reassuranceId = "cta-reassurance";

  return (
    <section aria-labelledby="hero-heading" className="text-center">
      <h1
        id="hero-heading"
        className="mx-auto max-w-4xl text-balance text-5xl sm:text-6xl font-semibold tracking-tight"
      >
        {HERO.headline}
      </h1>
      <p className="mx-auto mt-4 max-w-3xl text-pretty text-base text-muted-foreground sm:text-xl">
        {HERO.subheadline}
      </p>
      <div className="mt-6 flex items-center justify-center">
        <Button asChild size="lg" aria-describedby={reassuranceId}>
          <a href={PRIMARY_CTA_HREF} target="_blank" rel="noopener noreferrer">
            {HERO.ctaLabel}
            <ArrowRight className="size-5" />
          </a>
        </Button>
      </div>
      <p id={reassuranceId} className="mt-3 text-xs text-muted-foreground">
        {HERO.deRisk}
      </p>
    </section>
  );
}
