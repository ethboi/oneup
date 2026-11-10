// Every tab has its own address (/locks, /market…): the same single page, which reads the tab from the path. Here it
// gets its own title for the browser tab and shared links, and any other path is a 404 (app/not-found.tsx).

import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { TAB_PATHS, tabAt, tabDescription, tabTitle } from "@/lib/tabs";
import Home from "../page";

export const dynamicParams = false;
export const generateStaticParams = () => TAB_PATHS.map((tab) => ({ tab }));

type Props = { params: Promise<{ tab: string }> };

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const tab = tabAt((await params).tab);
  if (!tab) return {};
  const title = tabTitle(tab);
  const description = tabDescription(tab);
  // a tab's own openGraph replaces the layout's whole, so the share image is carried over by hand
  const inherited = await parent;
  return {
    title,
    description,
    openGraph: { title, description, siteName: "OneUp", type: "website", url: `/${(await params).tab}`, images: inherited.openGraph?.images },
    twitter: { card: "summary_large_image", title, description, images: inherited.twitter?.images },
  };
}

export default async function TabPage({ params }: Props) {
  if (!tabAt((await params).tab)) notFound();
  return <Home />;
}
