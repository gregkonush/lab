export type Benefit = {
  icon:
    | 'Layers'
    | 'Cloud'
    | 'Activity'
    | 'Boxes'
    | 'Eye'
    | 'Server'
    | 'Database'
    | 'ShieldCheck'
    | 'KeyRound'
    | 'Lock'
    | 'Network'
    | 'Brain'
  title: string
  text: string
}

export type CardItem = {
  icon?: Benefit['icon']
  title: string
  text: string
}

export type HeroHighlight = {
  title: string
  description: string
}

export type Metric = {
  value: string
  label: string
  sublabel: string
}

export type SocialProof = {
  name: string
  tagline: string
}

export type PlaybookStep = {
  title: string
  description: string
  timeframe: string
  result: string
}

export type FaqItem = {
  question: string
  answer: string
}

export const HERO = {
  announcement: {
    label: 'Launch Week: new control plane and guardrail packs',
    href: 'https://docs.proompteng.ai',
  },
  headline: 'ship ai agents',
  subheadline: 'proompteng is the control plane for engineers to launch, govern, and scale AI agents across any stack.',
  ctaLabel: 'talk to us',
  secondaryCtaLabel: 'book an architecture review',
  secondaryCtaHref: 'mailto:greg@proompteng.ai?subject=Architecture%20Review',
  deRisk: 'no credit card • deploy to your cloud • open-source control plane',
  highlights: [
    {
      title: 'policy-as-code guardrails',
      description: 'Ship rules from Git and enforce every call instantly.',
    },
    {
      title: 'observability on day one',
      description: 'Trace, replay, and compare agent decisions in seconds.',
    },
    {
      title: 'model freedom',
      description: 'Swap providers or weights without touching downstream code.',
    },
  ] satisfies HeroHighlight[],
} as const

export const PRIMARY_CTA_HREF = 'mailto:greg@proompteng.ai'

export const BENEFITS: Benefit[] = [
  {
    icon: 'Layers',
    title: 'works with your stack',
    text: 'Drop-in SDKs and APIs that meet your runtime where it lives.',
  },
  {
    icon: 'Cloud',
    title: 'run anywhere',
    text: 'Deploy on any cloud or on-prem with policy-controlled rollouts.',
  },
  {
    icon: 'Eye',
    title: 'built‑in visibility',
    text: 'Traces, evals, and cost metrics baked in from the first run.',
  },
  {
    icon: 'Boxes',
    title: 'model choice',
    text: 'swap providers and embeddings without lock‑in.',
  },
  {
    icon: 'ShieldCheck',
    title: 'guardrails',
    text: 'rate limits, safety checks, and audit trails by default.',
  },
  {
    icon: 'Database',
    title: 'memory + rag',
    text: 'pluggable stores for short/long‑term memory and retrieval.',
  },
]

export const FEATURES: CardItem[] = [
  {
    icon: 'Network',
    title: 'control plane',
    text: 'tools, routing, memory, and policies across environments.',
  },
  {
    icon: 'Activity',
    title: 'scale + govern',
    text: 'autoscale with retries; emit traces and cost metrics.',
  },
  {
    icon: 'Boxes',
    title: 'sdk + apis',
    text: 'http and adapters to integrate with any app or workflow.',
  },
]

export const INTEGRATIONS: CardItem[] = [
  {
    icon: 'Database',
    title: 'vector + storage',
    text: 'milvus, object storage, and search connectors.',
  },
  {
    icon: 'Brain',
    title: 'frameworks',
    text: 'vercel ai sdk, langgraph, langchain, llamaindex, autogen, crewai.',
  },
  {
    icon: 'Boxes',
    title: 'providers',
    text: 'openai, gemini, azure, and oss via adapters.',
  },
  {
    icon: 'Server',
    title: 'self-hosted weights',
    text: 'llama 3.1 405b, mistral large, qwen2, nemotron via on-prem deploys.',
  },
  {
    icon: 'Activity',
    title: 'domain copilots',
    text: 'financial, legal, healthcare tuned models with policy enforcement.',
  },
]

export const MODEL_CATALOG: CardItem[] = [
  {
    icon: 'Brain',
    title: 'openai o1-preview',
    text: 'reasoning-grade model with native tool use and long context support.',
  },
  {
    icon: 'Brain',
    title: 'claude 3.5 sonnet',
    text: 'balanced flagship with 200k context and audit-ready compliance scores.',
  },
  {
    icon: 'Server',
    title: 'deepseek r1',
    text: 'open reasoning weights optimized for complex workflows and cost efficiency.',
  },
  {
    icon: 'Boxes',
    title: 'gemini 2.0 flash',
    text: 'multimodal stack for real-time agents with streaming outputs.',
  },
  {
    icon: 'Server',
    title: 'llama 3.1 70b',
    text: 'self-hostable model with tuned guardrails and policy routing support.',
  },
  {
    icon: 'Database',
    title: 'voyage multipass',
    text: 'high-signal embeddings and rerankers for hybrid rag pipelines.',
  },
]

export const SECURITY: CardItem[] = [
  {
    icon: 'KeyRound',
    title: 'secrets isolation',
    text: 'scoped tokens and rbac for model/tool usage.',
  },
  {
    icon: 'ShieldCheck',
    title: 'audit trails',
    text: 'every call and data access is logged.',
  },
  {
    icon: 'Lock',
    title: 'pii handling',
    text: 'field‑level encryption and redact‑on‑read policies.',
  },
]

export const OBSERVABILITY: CardItem[] = [
  {
    icon: 'Eye',
    title: 'tracing',
    text: 'opentelemetry‑backed traces and dashboards.',
  },
  {
    icon: 'Activity',
    title: 'evals + guardrails',
    text: 'ci gates, safety checks, cost controls.',
  },
]

export const TESTIMONIAL = {
  quote:
    'proompteng turned weeks of glue work into a one‑day launch for our first AI agent — with end‑to‑end governance ready for audit.',
  author: 'Head of Platform',
  org: 'Design Partner Co.',
} as const

export const METRICS: Metric[] = [
  {
    value: '9x',
    label: 'faster to production',
    sublabel: 'teams shrinking agent rollout timelines from quarters to days.',
  },
  {
    value: '45%',
    label: 'lower runtime spend',
    sublabel: 'Smart routing and caching trim wasted calls and spend.',
  },
  {
    value: '99.7%',
    label: 'observed uptime',
    sublabel: 'Multi-region control plane with one-click rollbacks.',
  },
]

export const SOCIAL_PROOF: SocialProof[] = [
  { name: 'Northwind Research', tagline: 'governed AI agents for biotech' },
  {
    name: 'Lambda Logistics',
    tagline: 'dispatch automation across 18 markets',
  },
  { name: 'Atlas Legal', tagline: 'document AI agents with audit trails' },
  { name: 'Helios Cloud', tagline: 'multi‑model experimentation at scale' },
  { name: 'Orbit Studio', tagline: 'creative tooling for product designers' },
  { name: 'Mosaic Analytics', tagline: 'regulated AI agents for fintech' },
]

export const PLAYBOOK: PlaybookStep[] = [
  {
    title: 'day 0: connect your stack',
    description: 'Drop in the SDK, sync schemas, and register tools without rewrites.',
    timeframe: '~90 minutes',
    result: 'AI agents running in staging with policy packs applied.',
  },
  {
    title: 'day 1: instrument everything',
    description: 'Enable OpenTelemetry export, start collecting traces, and stand up eval suites.',
    timeframe: '~half day',
    result: 'Dashboards streaming cost, latency, and win/loss scores.',
  },
  {
    title: 'day 3: go live safely',
    description: 'Progressive rollouts, automated guardrails, and human-in-the-loop overrides.',
    timeframe: '~one day',
    result: 'Production traffic with controlled exposure and auto rollbacks.',
  },
  {
    title: 'day 7: scale globally',
    description: 'Promote playbooks to new regions, replicate memory stores, and reuse workflows.',
    timeframe: 'continuous',
    result: 'Multi-region availability with shared governance and routing.',
  },
]

export const FAQS: FaqItem[] = [
  {
    question: 'how does proompteng work with our existing llm provider?',
    answer:
      'use the adapters in our sdk or rest api to register providers once. policy routing keeps fallbacks, canary models, and cost‑based decisions outside your application logic.',
  },
  {
    question: 'can we self‑host the control plane?',
    answer:
      'yes. helm charts and terraform modules let you deploy to your own kubernetes clusters. argo cd keeps environments drift‑free.',
  },
  {
    question: 'what does onboarding look like?',
    answer:
      'import your agents, connect data stores, and run our launch checklist. solution architects help you wire evals, incident response, and compliance flows.',
  },
  {
    question: 'how is security handled?',
    answer:
      'field‑level encryption, scoped tokens, and audit trails ship by default. integrate with your sso and siem in under an hour.',
  },
]
