export default function DocsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-2 text-muted-foreground">
        Docs are coming soon. In the meantime, explore the platform pillars
        below.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-medium">Context engineering</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose prompts, system state, tools, and guardrails to shape agent
            behavior.
          </p>
        </section>
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-medium">Memory</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Short- and long-term memory with pluggable backends and retention
            policies.
          </p>
        </section>
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-medium">RAG</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Retrieval pipelines with chunkers, embedders, rerankers, and
            adapters.
          </p>
        </section>
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-medium">Vector stores</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bring your own store (Milvus, PGVecto.rs, Qdrant, etc.) with unified
            drivers.
          </p>
        </section>
      </div>
    </main>
  );
}
