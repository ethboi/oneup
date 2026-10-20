import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OneUp",
  description: "Perps against a house that can't go bust. Lose a trade, get an Extra Life.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
