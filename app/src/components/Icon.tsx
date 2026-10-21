// One line-icon set for controls: 24-unit grid, 2-unit round strokes, drawn in the current text colour.
// The pixel heart and coin (Pixel.tsx) stay the brand pieces; these are for actions and navigation.

const PATHS = {
  up: "M3 17l6-6 4 4 8-8M14 7h7v7",
  down: "M3 7l6 6 4-4 8 8M14 17h7v-7",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  wallet: "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l2.5-3H16M16 13.5h.01",
  deposit: "M12 3v11M7.5 9.5L12 14l4.5-4.5M4 19h16",
  withdraw: "M12 14V3M7.5 7.5L12 3l4.5 4.5M4 19h16",
  faucet: "M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7.5a4 4 0 0 1 8 0V11",
  unlock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7.5a4 4 0 0 1 7.6-1.7",
  claim: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-2.5-2.5-4-4.2-4a2 2 0 0 0 0 4M12 7c1-2.5 2.5-4 4.2-4a2 2 0 0 1 0 4",
  leave: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10",
  tag: "M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8.5 8.5-9 9z M8 8h.01",
  cart: "M3 4h2.2l2.4 11h10.6l2.3-8H6.2M10 20h.01M17 20h.01",
  chart: "M4 4v16h16M8 15l3.5-3.5 3 3L20 8",
  heart: "M12 20s-7.2-4.4-9.2-8.7A4.9 4.9 0 0 1 12 6.2a4.9 4.9 0 0 1 9.2 5.1C19.2 15.6 12 20 12 20z",
  store: "M4 9.5L5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5h16M9.5 20v-5.5h5V20",
  shield: "M12 3l8 3v6c0 4.4-3.4 8-8 9-4.6-1-8-4.6-8-9V6zM9 12l2 2 4-4",
  scale: "M12 4v16M6 20h12M4.5 8h15M7 8l-3 6.5a3 3 0 0 0 6 0zM17 8l-3 6.5a3 3 0 0 0 6 0z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  merge: "M6 4v5a5 5 0 0 0 5 5h7M6 20v-5M15 11l3 3-3 3",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  demo: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  share: "M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7",
} as const;

export type IconName = keyof typeof PATHS | "spinner";

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  if (name === "spinner") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={`spin ${className ?? ""}`} aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
