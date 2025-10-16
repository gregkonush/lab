import { TESTIMONIAL } from '@/app/config'

const TESTIMONIAL_HEADING_ID = 'testimonial-heading'

export default function Testimonial() {
  return (
    <section
      aria-labelledby={TESTIMONIAL_HEADING_ID}
      className="rounded-3xl border bg-primary/10 px-6 py-12 shadow-sm backdrop-blur sm:px-12"
    >
      <div className="mx-auto max-w-3xl text-center text-primary">
        <p className="text-xs font-semibold uppercase tracking-[0.3em]">customer spotlight</p>
        <h2 id={TESTIMONIAL_HEADING_ID} className="mt-2 text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
          <span aria-hidden className="mr-2 inline-block text-5xl leading-none">
            “
          </span>
          {TESTIMONIAL.quote}
          <span aria-hidden className="ml-2 inline-block text-5xl leading-none">
            ”
          </span>
        </h2>
        <p className="mt-6 text-sm uppercase tracking-[0.3em] text-primary/80">
          {TESTIMONIAL.author} · {TESTIMONIAL.org}
        </p>
      </div>
    </section>
  )
}
