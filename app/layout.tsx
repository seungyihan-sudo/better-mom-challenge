import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./additions.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "BMT 출석 · Better Mom Project";
  const description = "8월 8일부터 9월 4일까지, 매주 운동과 독서 3회를 함께 채우는 출석표";
  return { title, description, openGraph: { title, description, images: [`${origin}/og-bmt.png`] }, twitter: { card: "summary_large_image", title, description, images: [`${origin}/og-bmt.png`] } };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
