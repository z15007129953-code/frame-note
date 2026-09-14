import type { Metadata } from "next";
import SharedView from "./shared-view.tsx";
export const metadata: Metadata = { title: "Shared presentation — Frame Note", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ params }: { params: Promise<{id: string}> }) {
  const { id } = await params;
  return <SharedView key={id} id={id} />;
}
