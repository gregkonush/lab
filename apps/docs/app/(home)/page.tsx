import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-6 text-center">
      <div className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-wide text-fd-muted-foreground">
          Documentation Preview
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Everything you need to build with Proompteng
        </h1>
        <p className="mx-auto max-w-2xl text-base text-fd-muted-foreground">
          This site hosts the official guides for docs.proompteng.ai. Explore
          the getting started guide to understand environments, API access, and
          rollout checklists for your team.
        </p>
      </div>
      <div className="flex items-center justify-center gap-3">
        <Link
          href="/docs"
          className="rounded-md bg-fd-primary px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-fd-primary/90"
        >
          Read the docs
        </Link>
        <Link
          href="https://proompteng.ai"
          className="text-sm font-medium text-fd-foreground underline underline-offset-4"
        >
          Visit proompteng.ai
        </Link>
      </div>
    </main>
  );
}
