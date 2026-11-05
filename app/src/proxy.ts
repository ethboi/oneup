import { NextResponse, type NextRequest } from "next/server";

// The website and the app from one deployment: on the site's own hosts (ONEUP_SITE_HOSTS, such as
// oneup.markets), `/` is the website (src/app/site) and every other path moves to the app (ONEUP_APP_URL, such as
// https://app.oneup.markets), so an old link to /market still lands on the market. Unset, as on localnet and
// preview builds, nothing changes: the app is at `/` and the website at /site.
const siteHosts = (process.env.ONEUP_SITE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const appUrl = process.env.ONEUP_APP_URL;

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!siteHosts.includes(host)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/") return NextResponse.rewrite(new URL("/site", request.url));
  if (pathname === "/site" || pathname.startsWith("/site/")) return NextResponse.next();
  if (!appUrl) return NextResponse.next();
  return NextResponse.redirect(new URL(`${pathname}${search}`, appUrl), 308);
}

export const config = {
  // pages only: the build's files, Vercel's analytics and public assets (anything with an extension) pass straight through
  matcher: ["/((?!_next/|_vercel/|.*\\.[a-zA-Z0-9]+$).*)"],
};
