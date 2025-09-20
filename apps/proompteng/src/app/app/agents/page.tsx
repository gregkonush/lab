"use client";

import { api } from "@proompteng/backend/convex/_generated/api";
import { useQuery } from "convex/react";

import { Icon, type IconName } from "@/components/icon";
import ModelsGrid from "@/components/models-grid";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

const AGENT_PATTERNS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "Activity",
    title: "policy-first orchestration",
    text: "call proompteng routing from convex actions with guardrails baked in.",
  },
  {
    icon: "Eye",
    title: "observability on tap",
    text: "store traces, evals, and cost metrics in convex for instant dashboards.",
  },
  {
    icon: "KeyRound",
    title: "role aware sessions",
    text: "enforce scopes and pii policies per agent run with convex auth hooks.",
  },
  {
    icon: "Network",
    title: "tool + memory mesh",
    text: "hydrate rag, tools, and memories across agents without moving infra.",
  },
];

export default function AgentsPage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <div className="max-w-2xl space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Agents workspace
          </h2>
          <p className="text-sm text-muted-foreground sm:text-base">
            Monitor live sessions, review routing policies, and connect
            Proompteng orchestration to Convex state without switching tabs.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {AGENT_PATTERNS.map((pattern) => (
            <Badge
              key={pattern.title}
              variant="outline"
              className="gap-1 px-3 py-1 text-xs"
            >
              <Icon name={pattern.icon} className="size-3" />
              {pattern.title}
            </Badge>
          ))}
        </div>
      </section>

      {convexUrl ? (
        <section className="space-y-6">
          <h3 className="text-2xl font-semibold tracking-tight">
            Active agents
          </h3>
          <LiveAgentsList />
        </section>
      ) : null}

      <section className="space-y-6">
        <ModelsGrid limit={8} />
      </section>

      <RealTimePlaySection />
    </div>
  );
}

function LiveAgentsList() {
  const agents = useQuery(api.agents.list, {});

  if (agents === undefined) {
    return <AgentsSkeleton />;
  }

  if (!agents.length) {
    return (
      <Card className="border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle className="text-lg">No agents yet</CardTitle>
          <CardDescription>
            As soon as you deploy an agent through Proompteng it will appear
            here with live status and routing data.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <Card key={agent._id} className="border-border/60 bg-card/80">
          <CardHeader className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-border/40 bg-primary/10 p-2">
                <Icon name="Activity" className="size-5" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-lg">{agent.name}</CardTitle>
                <CardDescription className="text-xs uppercase tracking-[0.25em]">
                  model {agent.modelSlug} · status {agent.status}
                </CardDescription>
              </div>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-3">
              {agent.description || "No description provided."}
            </p>
            <div className="flex flex-wrap gap-1">
              {agent.tags.map((tag) => (
                <Badge key={`${agent._id}-${tag}`} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function AgentsSkeleton() {
  const placeholders = ["alpha", "beta", "gamma", "delta"];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {placeholders.map((key) => (
        <Card key={key} className="border-border/60 bg-card/80">
          <CardHeader className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-border/40 bg-muted/40 p-2">
                <div className="h-5 w-5 animate-pulse rounded-sm bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="h-20 w-full animate-pulse rounded bg-muted" />
            <div className="flex gap-1">
              <div className="h-6 w-16 animate-pulse rounded bg-muted" />
              <div className="h-6 w-12 animate-pulse rounded bg-muted" />
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function RealTimePlaySection() {
  const CODE_EXAMPLES = [
    {
      value: "action",
      label: "Action: orchestrate models",
      description:
        "Call Proompteng from a Convex action to pick the best model and persist inference telemetry.",
      code: ROUTE_PROMPT_CODE,
    },
    {
      value: "query",
      label: "Query: realtime feed",
      description:
        "Stream the latest inferences (optionally filtered by session) into any Convex-powered dashboard.",
      code: LIVE_FEED_CODE,
    },
    {
      value: "client",
      label: "Client: live console",
      description:
        "Use Convex hooks to render an always-fresh view of model responses, evals, and manual reruns.",
      code: CLIENT_PANEL_CODE,
    },
  ] as const;

  return (
    <section className="space-y-4">
      <h3 className="text-2xl font-semibold tracking-tight">
        Realtime playbook
      </h3>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Drop these snippets into your <code>convex/</code> directory and React
        clients to orchestrate models, persist telemetry, and render live views
        without manual polling.
      </p>
      <Tabs defaultValue={CODE_EXAMPLES[0].value} className="space-y-4">
        <TabsList>
          {CODE_EXAMPLES.map((example) => (
            <TabsTrigger key={example.value} value={example.value}>
              {example.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {CODE_EXAMPLES.map((example) => (
          <TabsContent key={example.value} value={example.value}>
            <Card className="border border-border/70 bg-card/80">
              <CardHeader>
                <CardTitle className="text-lg">{example.label}</CardTitle>
                <CardDescription>{example.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-xl bg-zinc-950/95 p-4 text-xs leading-relaxed text-zinc-100 shadow-inner">
                  <code>{example.code}</code>
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

const ROUTE_PROMPT_CODE = `import { action } from './_generated/server';
import { v } from 'convex/values';

export const routePrompt = action({
  args: {
    prompt: v.string(),
    sessionId: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const response = await fetch(process.env.PROOMPTENG_URL + '/v1/queries:route', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.PROOMPTENG_API_KEY,
      },
      body: JSON.stringify({
        prompt: args.prompt,
        session: args.sessionId,
        routing: { tags: args.tags, fallback: ['claude-3-5', 'o1-mini'] },
      }),
    });

    if (!response.ok) {
      throw new Error('failed to route prompt');
    }

    const result = await response.json();

    await ctx.db.insert('inferences', {
      sessionId: args.sessionId,
      requestId: result.requestId,
      model: result.model,
      latencyMs: result.metrics?.totalLatencyMs,
      createdAt: Date.now(),
    });

    return result;
  },
});` as const;

const LIVE_FEED_CODE = `import { query } from './_generated/server';
import { v } from 'convex/values';

export const liveInferenceFeed = query({
  args: {
    sessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 25;
    let feed = ctx.db.query('inferences');

    if (args.sessionId) {
      feed = feed.filter((q) => q.eq(q.field('sessionId'), args.sessionId));
    }

    return await feed.order('desc').take(limit);
  },
});` as const;

const CLIENT_PANEL_CODE = `'use client';

import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

type Props = { sessionId?: string };

export function LiveInferencePanel({ sessionId }: Props) {
  const feed = useQuery(api.inferences.liveInferenceFeed, {
    sessionId,
    limit: 20,
  });
  const reroute = useAction(api.orchestration.routePrompt);
  const tag = useMutation(api.inferences.tagInference);

  const rows = feed ?? [];

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row._id} className="rounded-lg border bg-card/60 p-3">
          <p className="text-sm font-medium">{row.model}</p>
          <p className="text-xs text-muted-foreground">
            latency {row.latencyMs}ms | tokens {row.metrics?.totalTokens ?? 0}
          </p>
          <div className="flex gap-2 pt-2">
            <button
              className="rounded-md border px-2 py-1 text-xs"
              onClick={() => reroute({ sessionId })}
            >
              reroute
            </button>
            <button
              className="rounded-md border px-2 py-1 text-xs"
              onClick={() => tag({ inferenceId: row._id, tag: 'investigate' })}
            >
              flag run
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}` as const;
