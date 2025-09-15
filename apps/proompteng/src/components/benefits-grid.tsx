import { BENEFITS } from "@/app/config";
import InfoCard from "@/components/info-card";

export default function BenefitsGrid() {
  return (
    <section aria-labelledby="benefits-heading" className="mt-12 sm:mt-16">
      <h2
        id="benefits-heading"
        className="text-center text-2xl sm:text-3xl font-semibold tracking-tight"
      >
        why teams choose proompteng
      </h2>
      <p className="mx-auto mt-2 max-w-3xl text-center text-sm text-muted-foreground">
        ship agents faster with a platform that’s productive on day one and
        dependable at scale.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map(({ icon, title, text }) => (
          <InfoCard key={title} icon={icon} title={title} text={text} />
        ))}
      </div>
    </section>
  );
}
