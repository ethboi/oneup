// Any address that isn't a tab or a page: says so, with the way back.

import type { Metadata } from "next";
import { Logo } from "@/components/Pixel";

export const metadata: Metadata = { title: "Page not found · OneUp" };

export default function NotFound() {
  return (
    <main className="pixel-field mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo size={56} />
      <h1 className="page-title">Nothing at this address</h1>
      <p>The link may be mistyped, or the page has moved.</p>
      <div className="flex w-full flex-col gap-3">
        <a className="btn btn-accent w-full" href="/">
          Open Trade
        </a>
        <a className="btn btn-ghost w-full" href="/market">
          Browse the Market
        </a>
      </div>
    </main>
  );
}
