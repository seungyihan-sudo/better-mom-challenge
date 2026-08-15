import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "베러맘 · 나를 돌보는 4주";
  const description = "운동과 독서를 주 3회씩, 함께 채워가는 베러맘 챌린지";
  return { title, description, openGraph: { title, description, images: [`${origin}/og.png`] }, twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] } };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
