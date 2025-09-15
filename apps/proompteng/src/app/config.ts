export type Benefit = {
  icon:
    | "Layers"
    | "Cloud"
    | "Activity"
    | "Boxes"
    | "Eye"
    | "Server"
    | "Database"
    | "ShieldCheck"
    | "KeyRound"
    | "Lock"
    | "Network"
    | "Brain";
  title: string;
  text: string;
};

export type CardItem = {
  icon?: Benefit["icon"];
  title: string;
  text: string;
};

export const HERO = {
  headline: "Deploy AI agents to production — any stack",
  subheadline:
    "One platform to ship, operate, and govern agents across languages and clouds.",
  ctaLabel: "Get started free",
  deRisk: "No credit card. Open source friendly.",
} as const;

export const PRIMARY_CTA_HREF = "https://github.com/gregkonush/lab";

export const BENEFITS: Benefit[] = [
  {
    icon: "Layers",
    title: "Works with your stack",
    text: "Use any language, framework, or runtime — no rewrites.",
  },
  {
    icon: "Cloud",
    title: "Run anywhere",
    text: "Cloud or on‑prem, scale safely with policies and rollouts.",
  },
  {
    icon: "Eye",
    title: "Built‑in visibility",
    text: "Traces, metrics, and evaluations to debug and improve.",
  },
  {
    icon: "Boxes",
    title: "Model choice",
    text: "Swap providers and embeddings without lock‑in.",
  },
  {
    icon: "ShieldCheck",
    title: "Guardrails",
    text: "Rate limits, safety checks, and audit trails by default.",
  },
  {
    icon: "Database",
    title: "Memory + RAG",
    text: "Pluggable stores for short/long‑term memory and retrieval.",
  },
];

export const FEATURES: CardItem[] = [
  {
    icon: "Network",
    title: "Control plane",
    text: "Tools, routing, memory, and policies across environments.",
  },
  {
    icon: "Activity",
    title: "Scale + govern",
    text: "Autoscale with retries; emit traces and cost metrics.",
  },
  {
    icon: "Boxes",
    title: "SDK + APIs",
    text: "HTTP and adapters to integrate with any app or workflow.",
  },
];

export const INTEGRATIONS: CardItem[] = [
  {
    icon: "Database",
    title: "Vector + storage",
    text: "Milvus, object storage, and search connectors.",
  },
  {
    icon: "Brain",
    title: "Frameworks",
    text: "Vercel AI SDK, LangGraph, LangChain, LlamaIndex, AutoGen, CrewAI.",
  },
  {
    icon: "Boxes",
    title: "Providers",
    text: "OpenAI, Gemini, Azure, and OSS via adapters.",
  },
];

export const SECURITY: CardItem[] = [
  {
    icon: "KeyRound",
    title: "Secrets isolation",
    text: "Scoped tokens and RBAC for model/tool usage.",
  },
  {
    icon: "ShieldCheck",
    title: "Audit trails",
    text: "Every call and data access is logged.",
  },
  {
    icon: "Lock",
    title: "PII handling",
    text: "Field‑level encryption and redact‑on‑read policies.",
  },
];

export const OBSERVABILITY: CardItem[] = [
  {
    icon: "Eye",
    title: "Tracing",
    text: "OpenTelemetry‑backed traces and dashboards.",
  },
  {
    icon: "Activity",
    title: "Evals + guardrails",
    text: "CI gates, safety checks, cost controls.",
  },
];

export const TESTIMONIAL = {
  quote:
    "Turned weeks of glue code into a one‑day launch for our first copilot.",
  author: "Head of Platform",
  org: "Design partner",
} as const;
