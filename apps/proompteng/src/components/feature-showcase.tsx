import {
  type CardItem,
  FEATURES,
  INTEGRATIONS,
  OBSERVABILITY,
  SECURITY,
} from "@/app/config";
import InfoCard from "@/components/info-card";

type ShowcaseSection = {
  id: string;
  kicker: string;
  heading: string;
  description: string;
  items: CardItem[];
};

const SECTIONS: ShowcaseSection[] = [
  {
    id: "governance",
    kicker: "control plane",
    heading: "Govern agents with policy-first workflows",
    description:
      "Version policies in git, roll out changes safely, and orchestrate routing, memory, and tools across every environment.",
    items: FEATURES,
  },
  {
    id: "integrations",
    kicker: "connect anything",
    heading: "Drop-in integrations for models, stores, and workflows",
    description:
      "Adapters for the providers and data sources you already use — no vendor lock-in, no brittle glue code.",
    items: INTEGRATIONS,
  },
  {
    id: "observability",
    kicker: "trust at scale",
    heading: "Secure, observable, human-in-the-loop by default",
    description:
      "Guardrails, audit trails, and evaluation pipelines keep every AI agent compliant and reliable from day one.",
    items: [...SECURITY, ...OBSERVABILITY],
  },
];

export default function FeatureShowcase() {
  return (
    <section className="space-y-16">
      {SECTIONS.map(({ id, kicker, heading, description, items }, index) => (
        <div
          key={id}
          id={id}
          className="rounded-3xl border bg-card/70 px-6 py-12 shadow-sm backdrop-blur sm:px-10"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-center">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">
                {kicker}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                {heading}
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">
                {description}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {items.map(({ icon, title, text }) => (
                <InfoCard
                  key={`${id}-${title}`}
                  icon={icon}
                  title={title}
                  text={text}
                  className={
                    index % 2 === 0 ? undefined : "lg:even:translate-y-6"
                  }
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
