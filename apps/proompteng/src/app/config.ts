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

export type ComparisonPoint = {
  capability: string
  proompteng: string
  salesforceAgentforce: string
  googleGemini: string
}

export const HERO = {
  announcement: {
    label: 'New: enterprise guardrail blueprints + SOC 2 toolkit',
    href: 'https://docs.proompteng.ai',
  },
  headline: 'enterprise ai agent control plane',
  subheadline:
    'proompteng lets platform and security teams govern, secure, and scale AI agents across any cloud with policy-as-code guardrails, unified observability, and multi-model orchestration.',
  ctaLabel: 'talk to us',
  secondaryCtaLabel: 'book an architecture review',
  secondaryCtaHref: 'mailto:greg@proompteng.ai?subject=Architecture%20Review',
  deRisk: 'soc 2 evidence • deploy in your vpc • open-source control plane',
  highlights: [
    {
      title: 'compliance-grade guardrails',
      description: 'Enforce policies from GitHub, sign every action, and ship audit-ready evidence.',
    },
    {
      title: 'multi-model orchestration',
      description: 'Route across OpenAI, Claude, Gemini, DeepSeek, and on-prem weights with one API.',
    },
    {
      title: 'traceable decisions',
      description: 'Replay conversations, diff agent runs, and share post-mortems in minutes.',
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

export const USE_CASES: CardItem[] = [
  {
    icon: 'ShieldCheck',
    title: 'regulated industries',
    text: 'launch compliant customer support and underwriting copilots with SOC 2 evidence and guardrails.',
  },
  {
    icon: 'Activity',
    title: 'operations automation',
    text: 'coordinate agent swarms for logistics, field service, and supply chain handoffs with audit-ready playbooks.',
  },
  {
    icon: 'Eye',
    title: 'agent observability',
    text: 'trace, replay, and evaluate AI assistant decisions to improve win rates and reduce hallucinations.',
  },
  {
    icon: 'Server',
    title: 'self-hosted agents',
    text: 'ship on-prem orchestration for sensitive data using mistral, gemini, and llama weights in your VPC.',
  },
  {
    icon: 'Network',
    title: 'multi-model routing',
    text: 'route across o1, claude 3.5, deepseek r1, and internal fine-tunes with policy-aware fallbacks.',
  },
  {
    icon: 'Database',
    title: 'governed rag',
    text: 'connect retrieval layers to agent memory with approvals, retention policies, and audit trails.',
  },
]

export const COMPARISON_POINTS = [
  {
    capability: 'Policy-as-code guardrails',
    proompteng: 'Versioned policies, approvals, and automated SOC 2 mappings out-of-the-box.',
    salesforceAgentforce: 'Limited to Salesforce ecosystem guardrails; custom code for external tools.',
    googleGemini: 'No native policy engine; relies on Cloud IAM and custom middleware.',
  },
  {
    capability: 'Multi-model orchestration',
    proompteng: 'Abstracted routing for OpenAI, Claude, Gemini, DeepSeek, open weights, and custom adapters.',
    salesforceAgentforce: 'Optimized for Einstein/GPT; external models via integrations with added latency.',
    googleGemini: 'Vendor-locked to Gemini family; third-party weights require Vertex custom pipelines.',
  },
  {
    capability: 'Observability & replay',
    proompteng: 'Full trace capture, diff tooling, eval hooks, and incident post-mortem exports.',
    salesforceAgentforce: 'Basic monitoring dashboards; limited replay for non-Salesforce channels.',
    googleGemini: 'Logging via Cloud Logging; replay needs custom instrumentation.',
  },
  {
    capability: 'Deployment flexibility',
    proompteng: 'SaaS or self-hosted in your VPC/Kubernetes with Terraform + Argo CD automation.',
    salesforceAgentforce: 'Runs in Salesforce cloud; no self-hosted option.',
    googleGemini: 'Runs on Google Cloud; hybrid requires complex networking.',
  },
] as const

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
    value: '40%',
    label: 'faster governance sign-off',
    sublabel: 'Policy-as-code reviews and SOC 2 evidence bundles cut approval cycles nearly in half.',
  },
  {
    value: '45%',
    label: 'lower runtime spend',
    sublabel: 'Multi-model routing and caching trim wasted LLM calls without sacrificing quality.',
  },
  {
    value: '99.9%',
    label: 'observed uptime',
    sublabel: 'Multi-region control plane with progressive delivery and instant rollback.',
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
    question: 'do you include compliance evidence for soc 2 or iso 27001?',
    answer:
      'yes. exportable policy logs, access trails, and change history map to soc 2 cc series and iso annex controls, ready for auditors.',
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
  {
    question: 'does proompteng support rbac for agent actions?',
    answer:
      'role- and policy-based controls restrict tool use, prompt libraries, and data access. approvals are logged and synced with your identity provider.',
  },
  {
    question: 'how do policy-as-code guardrails work in production?',
    answer:
      'policies compile to deterministic runtimes evaluated on every agent decision. violations are blocked instantly, alerts are dispatched, and remediation workflows retain full audit trails.',
  },
]
