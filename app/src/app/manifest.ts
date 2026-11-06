import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OneUp",
    short_name: "OneUp",
    description: "A perps game on NEAR where a losing trade can earn a Life NFT. NEAR testnet, test money.",
    start_url: "/",
    display: "standalone",
    background_color: "#15162a",
    theme_color: "#15162a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
