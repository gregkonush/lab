import { Icon, type IconName } from "@/components/icon";
import { cn } from "@/lib/utils";

export default function InfoCard({
  icon,
  title,
  text,
  className,
}: {
  icon?: IconName;
  title: string;
  text: string;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card p-6 text-card-foreground transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-md hover:border-ring/40",
        className,
      )}
    >
      {/* Decorative glow */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300",
          "before:absolute before:inset-0 before:rounded-[inherit] before:content-['']",
          "before:bg-[radial-gradient(120px_60px_at_85%_25%,_rgba(255,255,255,0.05),_transparent)]",
          "group-hover:opacity-100",
        )}
      />

      {/* Content */}
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>

      {/* Icon - absolute, subtle, animated */}
      {icon ? (
        <div className="absolute right-4 top-4 text-muted-foreground/40 transition-transform duration-300 ease-out group-hover:translate-x-0.5 group-hover:-rotate-3">
          <Icon name={icon} className="size-7" strokeWidth={1.25} />
        </div>
      ) : null}

      {/* Underline accent on hover */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-ring/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    </article>
  );
}
