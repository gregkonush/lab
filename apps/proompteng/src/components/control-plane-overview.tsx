import { COMPARISON_POINTS } from '@/app/config'

export default function ControlPlaneOverview() {
  return (
    <section
      id="control-plane"
      aria-labelledby="control-plane-heading"
      className="rounded-3xl border bg-card/75 px-6 py-12 shadow-sm backdrop-blur sm:px-12"
    >
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">control plane fundamentals</p>
        <h2 id="control-plane-heading" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          What is an AI Agent Control Plane?
        </h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          An AI agent control plane is the governance and orchestration layer that connects models, tools, and data
          while enforcing policy, observability, and deployment guardrails. proompteng centralizes these capabilities so
          platform, security, and operations teams can launch agents with confidence across clouds.
        </p>
      </div>

      <dl className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border bg-secondary/15 p-6 text-left">
          <dt className="text-sm font-semibold text-foreground">Policy-as-code governance</dt>
          <dd className="mt-2 text-sm text-muted-foreground">
            Enforce prompts, tools, and data access through versioned policies, approvals, and SOC 2-ready evidence.
          </dd>
        </div>
        <div className="rounded-2xl border bg-secondary/15 p-6 text-left">
          <dt className="text-sm font-semibold text-foreground">Unified observability</dt>
          <dd className="mt-2 text-sm text-muted-foreground">
            Capture traces, replay agent runs, and monitor quality, cost, and latency in a single pane of glass.
          </dd>
        </div>
        <div className="rounded-2xl border bg-secondary/15 p-6 text-left">
          <dt className="text-sm font-semibold text-foreground">Multi-model routing</dt>
          <dd className="mt-2 text-sm text-muted-foreground">
            Route across OpenAI, Claude 3.5, Gemini 2.0, DeepSeek, and self-hosted weights with policy-aware fallbacks.
          </dd>
        </div>
        <div className="rounded-2xl border bg-secondary/15 p-6 text-left">
          <dt className="text-sm font-semibold text-foreground">Operations automation</dt>
          <dd className="mt-2 text-sm text-muted-foreground">
            Automate playbooks for rollouts, incident response, and post-mortems while keeping stakeholders in the loop.
          </dd>
        </div>
      </dl>

      <div className="mt-12">
        <h3 className="text-center text-xl font-semibold tracking-tight sm:text-2xl">
          How proompteng compares to Agentforce and Gemini
        </h3>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <caption className="sr-only">
              Comparison between proompteng, Salesforce Agentforce, and Google Gemini
            </caption>
            <thead>
              <tr>
                <th scope="col" className="rounded-tl-xl border border-border/60 bg-secondary/25 px-4 py-3 font-medium">
                  Capability
                </th>
                <th scope="col" className="border border-border/60 bg-secondary/40 px-4 py-3 font-semibold">
                  proompteng
                </th>
                <th scope="col" className="border border-border/60 bg-secondary/25 px-4 py-3 font-medium">
                  Agentforce 360
                </th>
                <th scope="col" className="rounded-tr-xl border border-border/60 bg-secondary/25 px-4 py-3 font-medium">
                  Google Gemini for Agents
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_POINTS.map(({ capability, proompteng, salesforceAgentforce, googleGemini }, index) => {
                const isLast = index === COMPARISON_POINTS.length - 1
                return (
                  <tr key={capability}>
                    <th
                      scope="row"
                      className={`border border-border/60 bg-card/40 px-4 py-4 text-left font-semibold ${
                        isLast ? 'rounded-bl-xl' : ''
                      }`}
                    >
                      {capability}
                    </th>
                    <td className="border border-border/60 bg-card/80 px-4 py-4 font-medium text-foreground">
                      {proompteng}
                    </td>
                    <td className="border border-border/60 bg-card/60 px-4 py-4 text-muted-foreground">
                      {salesforceAgentforce}
                    </td>
                    <td
                      className={`border border-border/60 bg-card/60 px-4 py-4 text-muted-foreground ${
                        isLast ? 'rounded-br-xl' : ''
                      }`}
                    >
                      {googleGemini}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Looking for a deep dive? Request the governance checklist to benchmark policies, observability, and deployment
          flexibility across platforms.
        </p>
      </div>
    </section>
  )
}
