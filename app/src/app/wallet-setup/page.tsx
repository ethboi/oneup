export default function WalletSetup() {
  return <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-12">
    <a className="py-2 font-bold underline" href="/">← Back to OneUp</a>
    <h1 className="page-title">Use your own NEAR wallet</h1>
    <p>OneUp runs on NEAR testnet with test money. You need a testnet wallet and a little test NEAR for gas.</p>
    <div className="panel space-y-4 p-5">
      <ol className="list-decimal space-y-3 pl-5">
        <li>Create or import a test account in <a className="underline" href="https://wallet.meteorwallet.app" target="_blank" rel="noreferrer">Meteor Wallet</a>, switch it to testnet, and get some test NEAR.</li>
        <li>Back in OneUp, choose <b>Connect wallet</b>, pick Meteor or another testnet wallet, and allow the connection.</li>
        <li>Open <b>Account and funds</b>, register the test tokens and select <b>Get 1,000 test USDC</b>.</li>
        <li>Deposit, trade, and try the market. Your wallet asks you to approve each transaction.</li>
      </ol>
      <p className="label">OneUp uses NEAR Connect and requests no access key when you connect. Reconnect after a full page reload. MyNearWallet, Rabby and Phantom aren&apos;t supported. Never enter a seed phrase or private key into OneUp.</p>
    </div>
    <details className="panel p-5">
      <summary className="cursor-pointer py-1 font-bold">Running your own copy</summary>
      <div className="mt-3 space-y-3">
        <p>Follow <a className="underline" href="https://github.com/ethboi/oneup/blob/main/docs/NEAR_WALLET_SETUP.md" target="_blank" rel="noreferrer">the wallet setup guide</a> in the repository. Set <code>ONEUP_PUBLIC_CONFIG</code> to the generated testnet configuration, which holds contract addresses and never any keys, and run the keeper separately.</p>
        <p>The oracle and test tokens are demonstration contracts, so connecting a real wallet doesn&apos;t make them production services.</p>
      </div>
    </details>
  </main>;
}
