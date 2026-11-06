import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c, Pixelify_Sans } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Pixelify Sans: the console's display face (logo, HUD, tabs, big numbers).
// M PLUS Rounded 1c: everything you read.
const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-pixel" });
const rounded = M_PLUS_Rounded_1c({ subsets: ["latin"], weight: ["400", "500", "700", "800"], variable: "--font-rounded" });

/** Our Google Analytics stream, for the live site and app only: never a preview, a local demo or a judge's run. */
const GA_ID = process.env.VERCEL_ENV === "production" ? "G-MXCW2QCS5E" : null;

const description = "Perpetual trading with capped profits and Life NFTs for eligible losses. A NEAR prototype using test money; recovery is not guaranteed.";

// the image files beside this one (opengraph-image, twitter-image, icon, apple-icon) are added to the page by Next
export const metadata: Metadata = {
  metadataBase: process.env.ONEUP_APP_URL ? new URL(process.env.ONEUP_APP_URL) : undefined,
  title: "OneUp",
  description,
  openGraph: { title: "OneUp", description, siteName: "OneUp", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title: "OneUp", description },
};

export const viewport: Viewport = { themeColor: "#15162a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // dark only; the script marks a session that has already seen the power-on screen, before anything paints
    <html lang="en" className={`${pixel.variable} ${rounded.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem("oneup.booted")==="1"&&!new URLSearchParams(location.search).has("boot"))document.documentElement.dataset.booted="1"}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        {/* visit counts for the hosted site; never on a local demo or a judge's run */}
        {process.env.VERCEL && <Analytics />}
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${GA_ID}");`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
