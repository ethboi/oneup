import type { Metadata } from "next";
import { LifeCard } from "@/components/LifeCard";
import { Logo, PixelCoin, PixelHeart, PixelLock } from "@/components/Pixel";
import "./site.css";

// oneup.markets: the website, written like the handheld's instruction booklet. The console is the hero, with the
// demo video on its screen; then how to play, what an Extra Life is, and what NEAR does. src/proxy.ts serves it at
// `/` on the site's own hosts; anywhere else it is at /site.

export const metadata: Metadata = {
  title: "OneUp: lose a trade, get a life",
  description:
    "A perpetual futures game on NEAR. When the house ends a round in profit, traders with a net loss get an Extra Life: an NFT holding USDC and a share of future house profit. NEAR testnet, test money.",
};

const APP = process.env.ONEUP_APP_URL ?? "/";
/** The demo video (an mp4 URL); until it's set, the screen shows a recording of the app. */
const VIDEO = process.env.ONEUP_DEMO_VIDEO;
/** The public repository, once it is public. */
const REPO = process.env.ONEUP_REPO_URL;

export default function Site() {
  return (
    <div className="site">
      <header className="site-bar">
        <a href="#top" className="site-brand">
          <Logo size={28} />
          <span className="display">OneUp</span>
        </a>
        <nav className="site-nav" aria-label="Sections">
          <a href="#how">How to play</a>
          <a href="#life">Extra Lives</a>
          <a href="#near">NEAR</a>
        </nav>
        <a className="btn btn-accent site-bar-cta" href={APP}>
          Open app
        </a>
      </header>

      <main id="top">
        <section className="site-hero">
          <div className="site-hero-copy">
            <h1 className="display site-title">
              <span>Lose a trade.</span>
              <span>Get a life.</span>
            </h1>
            <p className="site-lede">
              OneUp is a perpetual futures game on NEAR. When the house ends a round in profit, every trader with a net
              loss gets an Extra Life: an NFT holding USDC you can claim, plus a share of the house’s profit for the next
              13 rounds. Keep it, claim it or sell it.
            </p>
            <div className="site-ctas">
              <a className="btn btn-accent btn-big" href={APP}>
                Open the app
              </a>
              <a className="btn btn-ghost btn-big" href="#demo">
                Watch the demo
              </a>
            </div>
            <p className="label">On NEAR testnet with test money. Connect a testnet wallet, or look around without one.</p>
          </div>

          <figure id="demo" className="site-console case">
            <div className="site-console-top" aria-hidden>
              <span className="site-led" />
              <span>POWER</span>
              <span className="display site-console-brand">OneUp</span>
            </div>
            <div className="bezel site-bezel">
              <div className="faceplate mb-3" aria-hidden>
                <span className="stripes" />
                <span className="faceplate-print">NEAR HACKATHON 2026</span>
                <span className="stripes" />
              </div>
              <div className="lcd site-screen">
                {VIDEO ? (
                  <video src={VIDEO} controls playsInline preload="metadata" poster="/site/app-preview.gif" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/site/app-preview.gif" alt="OneUp's trading screen: a live price chart, an order ticket and open positions" />
                )}
              </div>
            </div>
            <div className="site-keys" aria-hidden>
              <span className="site-dpad" />
              <span className="site-ab">
                <span className="site-key short">SHORT</span>
                <span className="site-key long">LONG</span>
              </span>
            </div>
            <figcaption className="sr-only">The OneUp demo, on the handheld’s screen</figcaption>
          </figure>
        </section>

        <section id="how" className="site-section">
          <h2 className="display site-h2">How to play</h2>
          <ol className="site-steps">
            <li className="panel site-step">
              <div className="site-step-art" aria-hidden>
                <span className="site-key long">LONG</span>
                <span className="site-key short">SHORT</span>
              </div>
              <h3 className="display">Pick a side</h3>
              <p>Go long or short on BTC, ETH or NEAR, up to 1000×. There are no entry or funding fees; winning trades pay a fee on their profit.</p>
            </li>
            <li className="panel site-step">
              <div className="site-step-art" aria-hidden>
                <span className="site-liquidated display">LIQUIDATED</span>
              </div>
              <h3 className="display">Lose it</h3>
              <p>Get liquidated, or close at a loss. On most venues that’s the end of it: your loss is the house’s profit.</p>
            </li>
            <li className="panel site-step">
              <div className="site-step-art site-step-card" aria-hidden>
                <LifeCard id="127" paid={0n} owed={300n} state="earning" tone="long" tag="LONG" detail="NEAR 50×" amount="$0 / $300" />
              </div>
              <h3 className="display">Get an Extra Life</h3>
              <p>If the house ends the round in profit, each wallet with a net loss gets an Extra Life NFT, and $1UP locked for two years.</p>
            </li>
            <li className="panel site-step">
              <div className="site-step-art" aria-hidden>
                <PixelCoin size={44} />
                <PixelHeart size={44} />
              </div>
              <h3 className="display">Claim it or sell it</h3>
              <p>Claim its USDC as the house keeps earning, or list it on the market. Whoever holds it gets the payouts still to come.</p>
            </li>
          </ol>
        </section>

        <section id="life" className="site-section site-life">
          <div className="site-cards" aria-hidden>
            <LifeCard id="219" paid={30n} owed={240n} state="earning" tone="long" tag="LONG" detail="ETH 1000×" amount="$30 / $240" />
            <LifeCard id="42" paid={1300n} owed={2000n} state="earning" backer tone="backer" tag="BACKER" detail="House pool" amount="$1,300 / $2,000" />
            <LifeCard id="311" paid={600n} owed={600n} state="full_heal" tone="short" tag="SHORT" detail="BTC 100×" amount="$600 / $600" />
          </div>
          <div>
            <h2 className="display site-h2">What’s in an Extra Life</h2>
            <dl className="site-facts">
              <div>
                <dt className="display">USDC to claim</dt>
                <dd>Part of the round’s profit is in it from the moment it’s minted.</dd>
              </div>
              <div>
                <dt className="display">13 more rounds</dt>
                <dd>It keeps taking a share of the house’s profit each round, until it has paid 1.2–2× its face value or the 13 rounds run out.</dd>
              </div>
              <div>
                <dt className="display">Yours to sell</dt>
                <dd>It’s an NFT. List it on the market: the buyer gets its unclaimed USDC and every payout after.</dd>
              </div>
              <div>
                <dt className="display">Its picture is its balance</dt>
                <dd>The heart fills row by row as it pays out, drawn by the contract itself. Backers who fund the house get gold ones.</dd>
              </div>
            </dl>
            <p className="label site-caveat">Payouts depend on the house’s future profit. They can be zero.</p>
          </div>
        </section>

        <section id="near" className="site-section">
          <h2 className="display site-h2">What NEAR does here</h2>
          <ul className="site-near">
            <li className="panel">
              <PixelHeart size={28} />
              <h3 className="display">An NFT that holds money</h3>
              <p>Each Extra Life is a NEP-171 token that claims NEP-141 USDC from the house. Sell the token and the claim goes with it.</p>
            </li>
            <li className="panel">
              <PixelCoin size={28} />
              <h3 className="display">Deposits from other chains</h3>
              <p>With NEAR Intents, one signed intent swaps a bridged token, deposits it and opens the trade.</p>
            </li>
            <li className="panel">
              <PixelLock size={28} />
              <h3 className="display">Run by a DAO</h3>
              <p>A Sputnik DAO owns the house, the Extra Lives and the price oracle, and votes on new markets.</p>
            </li>
            <li className="panel">
              <Logo size={28} />
              <h3 className="display">One tap, or an agent</h3>
              <p>Function-call keys and a NEP-366 relayer make trading one tap and gasless. AI agents trade through an MCP server.</p>
            </li>
          </ul>
          <p className="label site-caveat">
            On testnet now: trading, Extra Lives, claims and the market. Intents deposits (with a simulated bridge), DAO
            ownership, gasless trading and agents run in the local demo.
          </p>
        </section>

        <section className="site-section site-end">
          <h2 className="display site-h2">Press start</h2>
          <a className="btn btn-accent btn-big" href={APP}>
            Open the app
          </a>
          <p className="label">
            A NEAR HACKATHON 2026 prototype on testnet. Test USDC, and a mock oracle, swap and vault. The contracts haven’t been
            audited. Don’t use real funds.
          </p>
        </section>
      </main>

      <footer className="site-foot label">
        <span>
          Built by{" "}
          <a href="https://x.com/ethboi_" target="_blank" rel="noreferrer">
            @ethboi_
          </a>
        </span>
        {REPO && (
          <a href={REPO} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        )}
      </footer>
    </div>
  );
}
