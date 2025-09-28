import { generateOgImageParams, getPageImage, source } from "@/lib/source";
import { generate as DefaultImage } from "fumadocs-ui/og";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/og/docs/[...slug]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return new ImageResponse(
    (
      <DefaultImage
        title={page.data.title}
        description={page.data.description}
        site="proompteng documentation"
      />
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}

export function generateStaticParams() {
  return generateOgImageParams();
}
