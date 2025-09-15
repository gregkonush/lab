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
  headline: "deploy ai agents to production",
  subheadline:
    "one platform to ship, operate, and govern agents across languages and clouds.",
  ctaLabel: "get started free",
  deRisk: "no credit card. open source friendly.",
} as const;

export const PRIMARY_CTA_HREF = "https://github.com/gregkonush/lab";

export const BENEFITS: Benefit[] = [
  {
    icon: "Layers",
    title: "works with your stack",
    text: "use any language, framework, or runtime — no rewrites.",
  },
  {
    icon: "Cloud",
    title: "run anywhere",
    text: "cloud or on‑prem, scale safely with policies and rollouts.",
  },
  {
    icon: "Eye",
    title: "built‑in visibility",
    text: "traces, metrics, and evaluations to debug and improve.",
  },
  {
    icon: "Boxes",
    title: "model choice",
    text: "swap providers and embeddings without lock‑in.",
  },
  {
    icon: "ShieldCheck",
    title: "guardrails",
    text: "rate limits, safety checks, and audit trails by default.",
  },
  {
    icon: "Database",
    title: "memory + rag",
    text: "pluggable stores for short/long‑term memory and retrieval.",
  },
];

export const FEATURES: CardItem[] = [
  {
    icon: "Network",
    title: "control plane",
    text: "tools, routing, memory, and policies across environments.",
  },
  {
    icon: "Activity",
    title: "scale + govern",
    text: "autoscale with retries; emit traces and cost metrics.",
  },
  {
    icon: "Boxes",
    title: "sdk + apis",
    text: "http and adapters to integrate with any app or workflow.",
  },
];

export const INTEGRATIONS: CardItem[] = [
  {
    icon: "Database",
    title: "vector + storage",
    text: "milvus, object storage, and search connectors.",
  },
  {
    icon: "Brain",
    title: "frameworks",
    text: "vercel ai sdk, langgraph, langchain, llamaindex, autogen, crewai.",
  },
  {
    icon: "Boxes",
    title: "providers",
    text: "openai, gemini, azure, and oss via adapters.",
  },
];

export const SECURITY: CardItem[] = [
  {
    icon: "KeyRound",
    title: "secrets isolation",
    text: "scoped tokens and rbac for model/tool usage.",
  },
  {
    icon: "ShieldCheck",
    title: "audit trails",
    text: "every call and data access is logged.",
  },
  {
    icon: "Lock",
    title: "pii handling",
    text: "field‑level encryption and redact‑on‑read policies.",
  },
];

export const OBSERVABILITY: CardItem[] = [
  {
    icon: "Eye",
    title: "tracing",
    text: "opentelemetry‑backed traces and dashboards.",
  },
  {
    icon: "Activity",
    title: "evals + guardrails",
    text: "ci gates, safety checks, cost controls.",
  },
];

export const TESTIMONIAL = {
  quote:
    "turned weeks of glue code into a one‑day launch for our first copilot.",
  author: "head of platform",
  org: "design partner",
} as const;
