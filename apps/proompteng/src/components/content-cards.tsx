import type { CardItem } from "@/app/config";
import InfoCard from "@/components/info-card";

export default function ContentCards({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: CardItem[];
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-12 sm:mt-16">
      <h2
        id={`${id}-heading`}
        className="text-2xl sm:text-3xl font-semibold tracking-tight text-center"
      >
        {title}
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {items.map(({ icon, title, text }) => (
          <InfoCard key={title} icon={icon} title={title} text={text} />
        ))}
      </div>
    </section>
  );
}
