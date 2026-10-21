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
    <html lang="en" className={`${pixel.variable} ${rounded.variable}`}>
      <body>{children}</body>
    </html>
  );
}
