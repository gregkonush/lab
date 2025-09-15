import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  return (
    <nav
      aria-label="Primary"
      className="flex items-center justify-between py-6"
    >
      <div className="text-xl font-semibold tracking-tight">ProomptEng AI</div>
      <div className="flex items-center gap-3">
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href="/docs"
        >
          Docs
        </Link>
        <Button asChild size="sm" variant="default">
          <a
            href="https://github.com/gregkonush/lab"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get started
          </a>
        </Button>
      </div>
    </nav>
  );
}
