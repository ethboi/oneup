import type { Metadata } from "next";
import { LifeCard } from "@/components/LifeCard";
import { Logo, PixelCoin, PixelHeart } from "@/components/Pixel";
import { liveStats } from "./live-stats";
import "./site.css";

// oneup.markets: the website. The logo and one line open it, over a pixel chart; then the console with the demo on
// its screen, how it works, what a Life NFT is, and what NEAR does. src/proxy.ts serves it at
// `/` on the site's own hosts; anywhere else it is at /site.

const TITLE = "OneUp: lose a trade, get a life";
const DESCRIPTION =
  "A perpetual futures exchange on NEAR. When the house ends a round in profit, traders with a net loss get a Life NFT: an NFT that collects a share of future house profit. NEAR testnet, test money.";
/** The site's own host, so its preview image links there rather than to the app. */
const HOST = process.env.ONEUP_SITE_HOSTS?.split(",")[0]?.trim();

export const metadata: Metadata = {
  metadataBase: HOST ? new URL(`https://${HOST}`) : undefined,
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: "OneUp", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const APP = process.env.ONEUP_APP_URL ?? "/";
/** The demo video (an mp4 URL); until it's set, the screen shows a recording of the app. */
const VIDEO = process.env.ONEUP_DEMO_VIDEO;
/** The public repository. */
const REPO = process.env.ONEUP_REPO_URL ?? "https://github.com/ethboi/oneup";

/** The live numbers are read again at most every five minutes. */
export const revalidate = 300;

export default async function Site() {
  const stats = await liveStats();
  return (
    <div className="site">
      <header className="site-bar">
        <a href="#top" className="site-brand">
          <Logo size={28} />
          <span className="display">OneUp</span>
        </a>
        <nav className="site-nav" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#life">Life NFTs</a>
          <a href="#near">NEAR</a>
        </nav>
        <a className="btn btn-accent site-bar-cta" href={APP}>
          Open app
        </a>
      </header>

      <main id="top">
        <section className="site-hero">
          <h1 className="site-mark">
            <span className="site-mark-heart">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" width={110} height={100} />
              <span className="display" aria-hidden>+1</span>
            </span>
            <span className="display">OneUp</span>
          </h1>
          <p className="site-tagline">Perps where a loss can pay you back</p>
          <p className="site-lede">
            Lose in a round the house wins, and you can get a Life NFT that collects USDC from its future profit.
          </p>
          <div className="site-ctas">
            <a className="btn btn-accent btn-big" href={APP}>
              Open the app
            </a>
            <a className="btn btn-ghost btn-big" href="#demo">
              Watch the demo
            </a>
          </div>
          <p className="site-live">Live on NEAR testnet, with test money</p>
        </section>

        {stats && (
          <section className="site-section site-stats" aria-label="Live on NEAR testnet">
            <dl>
              <div>
                <dt>Rounds closed</dt>
                <dd className="display num">{stats.roundsClosed.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>Life NFTs earned</dt>
                <dd className="display num">{stats.livesMinted.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>Paid to Life NFTs</dt>
                <dd className="display num">${stats.paidUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </div>
              <div>
                <dt>Life NFTs resold</dt>
                <dd className="display num">{stats.resold.toLocaleString("en-US")}</dd>
              </div>
            </dl>
            <p className="label">
              Read from the testnet contracts every few minutes, in test USDC. Most trading so far is by our demo bots.
              {REPO && (
                <>
                  {" "}
                  <a href={`${REPO}#check-the-claims`} target="_blank" rel="noreferrer">
                    Check them yourself
                  </a>
                </>
              )}
            </p>
          </section>
        )}

        <section className="site-section site-demo">
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
                  <video src={VIDEO} controls playsInline preload="metadata" poster="/site/testimonial.webp" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <picture>
                    {/* no looping recording for anyone who's asked for less motion */}
                    <source media="(prefers-reduced-motion: reduce)" srcSet="/site/app-preview-still.webp" />
                    <img src="/site/app-preview.gif" alt="OneUp's trading screen: a live price chart, an order ticket and open positions" />
                  </picture>
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
          <h2 className="display site-h2">How it works</h2>
          <ol className="site-steps">
            <li className="panel site-step">
              <div className="site-step-art site-art-sky" aria-hidden>
                <svg className="site-art-line" viewBox="0 0 320 170" preserveAspectRatio="none">
                  <polyline points="0,130 40,118 70,126 110,92 150,104 190,70 230,80 270,44 320,30" />
                </svg>
                <span className="site-art-tag display">NEAR 50×</span>
                <div className="site-art-keys">
                  <span className="site-key long">LONG</span>
                  <span className="site-key short">SHORT</span>
                </div>
              </div>
              <h3 className="display">Pick a side</h3>
              <p>Go long or short on BTC, ETH or NEAR, up to 1000×. There are no entry or funding fees; winning trades pay 10–25% of their profit.</p>
            </li>
            <li className="panel site-step">
              <div className="site-step-art site-art-loss" aria-hidden>
                <svg className="site-art-line" viewBox="0 0 320 170" preserveAspectRatio="none">
                  <polyline points="0,24 60,30 110,26 150,48 190,44 225,92 255,118 285,150 320,168" />
                </svg>
                <span className="site-art-amount num">−$500.00</span>
                <span className="site-liquidated display">LIQUIDATED</span>
              </div>
              <h3 className="display">Lose it</h3>
              <p>Get liquidated, or close at a loss. On most venues that’s the end of it: your loss is the house’s profit.</p>
            </li>
            <li className="panel site-step">
              <div className="site-step-art site-step-card site-art-life" aria-hidden>
                <LifeCard id="127" paid={110n} owed={300n} state="earning" tone="long" tag="LONG" detail="NEAR 50×" amount="$110 / $300" />
              </div>
              <h3 className="display">Get a Life NFT</h3>
              <p>If the house ends the round in profit, each wallet with a net loss gets a Life NFT, and $1UP locked for 104 rounds.</p>
            </li>
            <li className="panel site-step">
              <div className="site-step-art site-art-gold" aria-hidden>
                <span className="site-art-choice">
                  <PixelCoin size={64} />
                  <b className="display">CLAIM</b>
                </span>
                <span className="site-art-or display">or</span>
                <span className="site-art-choice">
                  <PixelHeart size={64} />
                  <b className="display">SELL</b>
                </span>
              </div>
              <h3 className="display">Claim it or sell it</h3>
              <p>Claim the USDC it collects, or list it on the market. Whoever holds it gets the payouts still to come.</p>
            </li>
          </ol>
        </section>

        <section className="site-section site-ad">
          <figure className="site-tv">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/site/testimonial.webp"
              width={1200}
              height={675}
              loading="lazy"
              alt="Chad, a blond trader in sunglasses and red braces, holds up a gold Life NFT card and the handheld, beside a beaming TV host giving a thumbs up"
            />
          </figure>
          <div className="site-ad-copy">
            <blockquote className="display site-ad-quote">
              <p>Got liquidated.</p>
              <p>Got paid.</p>
            </blockquote>
            <p className="site-ad-by">Chad Lifeson, trader</p>
            <p className="label">
              Chad and the host are made-up characters from our ad, created with AI. Results not typical: a loss only earns a
              Life if the house ends the round in profit, and payouts can be zero.
            </p>
          </div>
        </section>

        <section id="life" className="site-section site-life">
          <div className="site-cards" aria-hidden>
            <LifeCard id="219" paid={30n} owed={240n} state="earning" tone="long" tag="LONG" detail="ETH 1000×" amount="$30 / $240" />
            <LifeCard id="42" paid={1300n} owed={2000n} state="earning" backer tone="backer" tag="BACKER" detail="House pool" amount="$1,300 / $2,000" />
            <LifeCard id="311" paid={600n} owed={600n} state="full_heal" tone="short" tag="SHORT" detail="BTC 100×" amount="$600 / $600" />
          </div>
          <div>
            <h2 className="display site-h2">What’s in a Life NFT</h2>
            <dl className="site-facts">
              <div>
                <dt className="display">USDC as it earns</dt>
                <dd>Each round, part of the house’s profit above its reserves goes to Life NFTs. What yours collects is there to claim.</dd>
              </div>
              <div>
                <dt className="display">13 more rounds</dt>
                <dd>It keeps collecting until it has paid 1.2–2× its face value or the 13 rounds run out. Face value comes from your share of the round’s losses, and is never more than your loss.</dd>
              </div>
              <div>
                <dt className="display">Yours to sell</dt>
                <dd>It’s an NFT. List it on the market, with a 2% seller fee: the buyer gets its unclaimed USDC and every payout after. A purchase names the listing the buyer saw, so if the seller claims first or changes the price, it fails and the USDC goes back.</dd>
              </div>
              <div>
                <dt className="display">Its picture is its balance</dt>
                <dd>The heart fills row by row as it pays out, drawn by the contract itself. Backers who fund the house get gold ones.</dd>
              </div>
            </dl>
            <p className="label site-caveat">Payouts depend on the house’s future profit and can be zero, even after a profitable round if the pool is below its reserves.</p>
          </div>
        </section>

        <section id="near" className="site-section">
          <h2 className="display site-h2">What NEAR does here</h2>
          <ul className="site-near">
            <li className="panel">
              <div className="site-near-art site-art-money" aria-hidden>
                <LifeCard id="88" paid={180n} owed={420n} state="earning" tone="recovery" tag="LOSS" detail="Round 12" amount="$180 / $420" />
                <div className="site-art-payouts">
                  <span><PixelCoin size={26} /> +$42 USDC</span>
                  <span><PixelCoin size={26} /> +$67 USDC</span>
                  <span><PixelCoin size={26} /> +$71 USDC</span>
                </div>
              </div>
              <span className="site-tag live">On testnet</span>
              <h3 className="display">An NFT with money attached</h3>
              <p>Each Life NFT is a NEP-171 token that claims NEP-141 USDC from the house. Sell the token and the claim goes with it.</p>
            </li>
            <li className="panel">
              <div className="site-near-art site-art-chains" aria-hidden>
                <div className="site-art-tokens">
                  <span>ETH</span>
                  <span>SOL</span>
                </div>
                <b className="site-art-arrow">→</b>
                <div className="site-art-intent">
                  <small>One signed intent</small>
                  <b>Swap</b>
                  <b>Deposit</b>
                  <b>Trade</b>
                </div>
              </div>
              <span className="site-tag">Local demo</span>
              <h3 className="display">Deposits from other chains</h3>
              <p>With NEAR Intents, one signed intent swaps a bridged token, deposits it and requests the trade. The bridge is simulated.</p>
            </li>
            <li className="panel">
              <div className="site-near-art site-art-dao" aria-hidden>
                <div className="site-art-ballot">
                  <small>Council proposal</small>
                  <b>List a new market</b>
                  <div className="site-art-votes"><span>Yes</span><i style={{ width: "100%" }} /><span>2</span></div>
                  <div className="site-art-votes no"><span>No</span><i style={{ width: "6%" }} /><span>0</span></div>
                  <em className="display">PASSED</em>
                </div>
              </div>
              <span className="site-tag">Local demo</span>
              <h3 className="display">Run by a DAO</h3>
              <p>A Sputnik DAO owns the house, the Life NFTs and the price oracle, and votes on new markets.</p>
            </li>
            <li className="panel">
              <div className="site-near-art site-art-agent" aria-hidden>
                <div className="site-art-tap">
                  <span className="site-key long">LONG</span>
                  <small>One tap, no gas</small>
                </div>
                <div className="site-art-chat">
                  <small>AI agent</small>
                  <b>Long NEAR 5×</b>
                  <span>“Momentum is up, stop set below entry.”</span>
                </div>
              </div>
              <span className="site-tag">Local demo</span>
              <h3 className="display">One tap, or an agent</h3>
              <p>Function-call keys and a NEP-366 relayer make trading one tap and gasless. AI agents trade through an MCP server.</p>
            </li>
          </ul>
          <p className="label site-caveat">
            On testnet: trading, Life NFTs, claims, locks and the market, owned by an operator account rather than a DAO.
          </p>
        </section>

        <section className="site-section site-end">
          <p className="display site-end-line">Lost again? Get a life.</p>
          <h2 className="display site-h2">Try it</h2>
          <a className="btn btn-accent btn-big" href={APP}>
            Open the app
          </a>
          <p className="label">
            No wallet needed to look around. A NEAR HACKATHON 2026 prototype on testnet: test USDC, and a mock oracle, swap and
            vault. The contracts haven’t been audited. Don’t use real funds.
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
