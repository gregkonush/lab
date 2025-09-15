import Link from "next/link";
import BenefitsGrid from "@/components/benefits-grid";
import Hero from "@/components/hero";
import Navbar from "@/components/navbar";

export default function Home() {
  return (
    <div className="font-sans min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-6">
        <header>
          <Navbar />
        </header>
        <main className="py-10 sm:py-16">
          <Hero />
          <BenefitsGrid />
          {/** Remove/replace extra content sections to keep the page concise **/}
          {/** <ContentCards id="how" title="How it works" items={FEATURES} /> **/}
          {/** <ContentCards id="architecture" title="Architecture overview" items={INTEGRATIONS} /> **/}
          {/** <ContentCards id="security" title="Security and compliance" items={SECURITY} /> **/}
          {/** <ContentCards id="observability" title="Observability and guardrails" items={OBSERVABILITY} /> **/}
        </main>
        <footer className="border-t py-8 mt-12 text-center text-sm text-muted-foreground">
          <div className="mb-2 flex flex-wrap items-center justify-center gap-4">
            {[
              { label: "Docs", href: "/docs" },
              { label: "Terraform", href: "https://github.com/gregkonush/lab" },
              { label: "Helm", href: "https://github.com/gregkonush/lab" },
              { label: "Status", href: "#" },
              { label: "Security", href: "#" },
              { label: "Changelog", href: "#" },
              { label: "Careers", href: "#" },
              { label: "Contact", href: "#" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <p>© {new Date().getFullYear()} ProomptEng AI.</p>
        </footer>
      </div>
    </div>
  );
}
