import type { Metadata } from "next";
import { M_PLUS_Rounded_1c, Pixelify_Sans } from "next/font/google";
import "./globals.css";

// Pixelify Sans: the console's display face (logo, HUD, tabs, big numbers).
// M PLUS Rounded 1c: everything you read.
const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-pixel" });
const rounded = M_PLUS_Rounded_1c({ subsets: ["latin"], weight: ["400", "500", "700", "800"], variable: "--font-rounded" });

export const metadata: Metadata = {
  title: "OneUp",
  description: "Perps against a house that can't go bust. Lose a trade, get an Extra Life.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // the theme goes on <html> before anything paints: your pick, else dark (lib/theme.ts; the key is spelled out
    // here because a server component can't read a value from a client module)
    <html lang="en" className={`${pixel.variable} ${rounded.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("oneup.theme");document.documentElement.dataset.theme=t==="light"?"light":"dark";if(sessionStorage.getItem("oneup.booted")==="1"&&!new URLSearchParams(location.search).has("boot"))document.documentElement.dataset.booted="1"}catch(e){document.documentElement.dataset.theme="dark"}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
