// The app's tabs, each at its own address (Trade is the root). The page shows the tab for the address; the route
// (app/[tab]/page.tsx) gives it a title and answers 404 for any other path.

export const TABS = ["Trade", "Life NFTs", "Locks", "Market", "Agents", "Leaders", "Jackpot", "Backing", "$1UP", "House", "About"] as const;
export type Tab = (typeof TABS)[number];

/** Each tab's address: /locks, /life-nfts, /house… (Trade is the root). */
export const slug = (t: Tab) => (t === "Trade" ? "" : t.toLowerCase().replace(/\$/g, "").replace(/\s+/g, "-"));
/** The tab's earlier address, so links already shared still open it. */
export const OLD_PATHS: Record<string, string> = { "extra-lives": "life-nfts" };

/** The tab at a path, or null when no tab lives there. */
export function tabAt(path: string): Tab | null {
  const name = path.replace(/^\/+|\/+$/g, "").toLowerCase();
  return TABS.find((t) => slug(t) === (OLD_PATHS[name] ?? name)) ?? null;
}
/** Every address that opens a tab other than the root. */
export const TAB_PATHS = [...TABS.filter((t) => t !== "Trade").map(slug), ...Object.keys(OLD_PATHS)];

/** What each tab is for, in a browser tab, a bookmark or a shared link. */
const ABOUT: Record<Tab, { title?: string; line: string }> = {
  Trade: { line: "Perpetual trading with capped profits and Life NFTs for eligible losses." },
  "Life NFTs": { line: "Life NFTs from eligible losses: what each has paid, what it can still receive and when it stops earning." },
  Locks: { title: "$1UP locks", line: "$1UP locks: locked rewards, their share of buybacks and when they unlock." },
  Market: { line: "Buy or list Life NFTs and $1UP locks for USDC." },
  Agents: { line: "AI agents trading on OneUp through MCP: their results, and how to connect your own." },
  Leaders: { title: "Leaderboard", line: "Every trader's profit and loss over a round, a day or all time." },
  Jackpot: { line: "The jackpot drawn among each period's net losers, and every past draw." },
  Backing: { title: "Back the house", line: "Back the house with USDC for a Backer Life and locked $1UP." },
  $1UP: { title: "$1UP tokenomics", line: "$1UP: the allocation, releases tied to house profit, and buybacks." },
  House: { title: "The house", line: "The house's on-chain reserves, each market's capacity and every round's result." },
  About: { title: "How it works", line: "How OneUp works: capped profits, Life NFTs for eligible losses, and what runs on NEAR." },
};
export const tabTitle = (t: Tab) => (t === "Trade" ? "OneUp" : `${ABOUT[t].title ?? t} · OneUp`);
export const tabDescription = (t: Tab) => `${ABOUT[t].line} A NEAR prototype using test money; recovery is not guaranteed.`;
