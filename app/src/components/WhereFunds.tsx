"use client";

// Where the USDC is right now, read from the contract views: the house pool and how it splits between the house
// contract and the vault, the jackpot, the Life NFT contract's USDC for Lives, and, with a wallet connected, the
// trader's own wallet, trading balance and margin. Each line names the account that holds it, linked to NearBlocks
// where an explorer indexes the network.

import { fmtUsdc } from "@oneup/sdk";
import { Icon } from "./Icon";
import { useOneUp, usePoll } from "@/lib/oneup";
import { explorer } from "@/lib/explorer";

const big = (x?: string | null) => (x === undefined || x === null ? undefined : BigInt(x));
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

function Line({ label, value, account, note, sub }: { label: string; value: bigint | undefined; account: string; note: React.ReactNode; sub?: boolean }) {
  const { d } = useOneUp();
  const href = explorer(d.network).account(account);
  return (
    <li className={`flex flex-col gap-1 py-2.5 ${sub ? "ml-1 border-l-2 border-[var(--line)] pl-3.5" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span className="num shrink-0 font-bold">{value === undefined ? "…" : `$${fmtUsdc(value)}`}</span>
      </div>
      <p className="label text-xs">{note}</p>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="label num flex items-center gap-1 self-start text-xs break-all hover:text-[var(--text)]" title="View the account on NearBlocks">
          <Icon name="share" size={12} className="shrink-0" />
          {account}
        </a>
      ) : (
        <span className="label num text-xs break-all">{account}</span>
      )}
    </li>
  );
}

export function WhereFunds({ pool }: { pool: bigint }) {
  const { o, d, me, viewOnly, wallet } = useOneUp();
  const c = d.contracts;
  const t = usePoll(() => o.treasury(), [], 5000);
  const vault = usePoll(() => o.vaultDeposit(), [], 10_000);
  const house = usePoll(() => o.usdcBalance(c.house), [], 10_000);
  const life = usePoll(() => Promise.all([o.usdcBalance(c.life), o.view<string>(c.life, "held")]), [], 10_000);
  const mine = usePoll(
    () => (viewOnly ? Promise.resolve(null) : Promise.all([o.usdcBalance(me), o.balance(me), o.positions(me), o.orders(me)])),
    [me, viewOnly],
    5000,
  );

  const deployed = t ? BigInt(t.deployed) : undefined;
  const hasVault = !!t?.vault && !!c.vault;
  const onHand = deployed === undefined ? undefined : pool > deployed ? pool - deployed : 0n;
  // the vault may hold at most `deployable`: what must stay is the rest (1.2× the maximum payouts plus the cash buffer)
  const mustStay = t ? pool - (BigInt(t.deployable) < pool ? BigInt(t.deployable) : pool) : undefined;
  const [lifeUsdc, lifeHeld] = life ?? [];
  const [walletUsdc, free, positions, orders] = mine ?? [];
  const inPositions = positions ? sum(positions.map((p) => BigInt(p.margin))) : undefined;
  const inOrders = orders ? sum(orders.map((x) => ("Open" in x.kind ? BigInt(x.kind.Open.margin) : 0n))) : undefined;
  const explorerName = d.network === "localnet" ? null : "NearBlocks";

  return (
    <div className="panel p-5" id="house-funds">
      <h2 id="house-usdc" className="scroll-mt-4 text-lg font-extrabold">Where the USDC sits</h2>
      <p className="label mt-1">
        Read from the contracts now. Each line names the account holding it{explorerName ? `; select one to open it on ${explorerName}` : ""}.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
        <section aria-label="The house's USDC">
          <h3 className="font-extrabold">The house</h3>
          <ul className="divide-y divide-[var(--line)]">
            <Line label="House pool" value={pool} account={c.house} note="The house's own USDC, which covers every open trade's maximum profit. It sits in two places:" />
            <Line
              sub
              label="Reserve kept on hand"
              value={onHand}
              account={c.house}
              note={
                hasVault && mustStay !== undefined ? (
                  <>
                    In the house contract. At least <b className="num text-[var(--text)]">${fmtUsdc(mustStay, 0)}</b> must stay here: 1.2× the maximum profit payouts plus a cash
                    buffer.
                  </>
                ) : (
                  "In the house contract."
                )
              }
            />
            {hasVault && (
              <Line
                sub
                label="Deployed to the vault"
                value={deployed}
                account={c.vault!}
                note={
                  vault ? (
                    <>
                      Lent to the mock vault to earn interest. The vault&apos;s own count: <b className="num text-[var(--text)]">${fmtUsdc(BigInt(vault.principal))}</b> lent
                      and <b className="num text-[var(--text)]">${fmtUsdc(BigInt(vault.interest))}</b> of interest owed.
                    </>
                  ) : (
                    "Lent to the mock vault to earn interest."
                  )
                }
              />
            )}
            {hasVault && t && (
              <Line
                label="Jackpot"
                value={big(t.jackpot)}
                account={c.house}
                note={`Vault interest brought back to the house contract, waiting for the draw after round ${t.draw_epoch}.`}
              />
            )}
            <Line
              label="Held for Lives"
              value={big(lifeUsdc)}
              account={c.life}
              note={
                lifeHeld !== undefined ? (
                  <>
                    USDC the Life NFT contract holds for Lives: rounds&apos; payouts that owners haven&apos;t claimed yet. Its own count of what is unclaimed:{" "}
                    <b className="num text-[var(--text)]">${fmtUsdc(BigInt(lifeHeld))}</b>.
                  </>
                ) : (
                  "USDC the Life NFT contract holds for Lives: rounds' payouts that owners haven't claimed yet."
                )
              }
            />
            <Line
              label="All USDC in the house contract"
              value={big(house)}
              account={c.house}
              note="Its whole token balance. Besides the reserve on hand it holds every trader's trading balance and margin, the jackpot, and USDC set aside for buybacks."
            />
          </ul>
        </section>
        <section aria-label="Your USDC">
          <h3 className="font-extrabold">Your USDC</h3>
          {viewOnly ? (
            <div className="flex flex-col items-start gap-3 py-2.5">
              <p className="label">Connect a NEAR testnet wallet to see your wallet USDC, your trading balance and the margin in your open positions.</p>
              <button type="button" className="btn btn-ghost" disabled={wallet.busy} onClick={() => void wallet.connect()}>
                <Icon name="wallet" />
                Connect wallet
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              <Line label="In your wallet" value={big(walletUsdc)} account={me} note="USDC in your own NEAR account, not yet deposited." />
              <Line label="Trading balance" value={big(free)} account={c.house} note="Free USDC in the house contract: ready to trade or withdraw." />
              <Line
                label="Margin in open positions"
                value={inPositions}
                account={c.house}
                note={
                  positions
                    ? `${positions.length} open position${positions.length === 1 ? "" : "s"}. The margin stays in the house contract until each one closes.`
                    : "The margin stays in the house contract until each position closes."
                }
              />
              {inOrders !== undefined && inOrders > 0n && (
                <Line label="Margin in orders waiting to fill" value={inOrders} account={c.house} note="Held for opens not filled yet. A cancelled or expired order puts it back in your trading balance." />
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
