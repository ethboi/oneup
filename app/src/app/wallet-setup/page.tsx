export default function WalletSetup() {
  return <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-12">
    <a className="font-bold underline" href="/">← Back to OneUp</a>
    <p className="label">OneUp · testnet setup</p>
    <h1 className="page-title">Use your own NEAR wallet</h1>
    <p>The local demo uses built-in test accounts. To connect your own wallet, run OneUp with a deployed NEAR testnet configuration.</p>
    <div className="panel space-y-4 p-5">
      <h2 className="text-xl font-bold">For testers</h2>
      <ol className="list-decimal space-y-3 pl-5">
        <li>Select the testnet network and create or import your test account in <a className="underline" href="https://wallet.meteorwallet.app" target="_blank" rel="noreferrer">Meteor Wallet</a>. Obtain test NEAR for gas.</li>
        <li>Open the configured testnet app and choose <b>Connect NEAR testnet wallet</b>. Choose Meteor or another compatible testnet wallet from the picker. Allow the wallet’s connection window.</li>
        <li>Open <b>Account and funds</b>, register the test tokens and use <b>Get 1,000 test USDC</b> if the deployment enables its test faucet.</li>
        <li>Deposit test USDC, trade, inspect a Life and try the marketplace. Each transaction asks for wallet approval.</li>
      </ol>
      <p className="label">OneUp uses NEAR Connect and requests no access key during connection. Reconnect after a full page reload. MyNearWallet is excluded because it is being sunset. Rabby and Phantom are not supported by this wallet integration. Never enter a seed phrase or private key into OneUp.</p>
    </div>
    <div className="panel space-y-4 p-5">
      <h2 className="text-xl font-bold">For the person running OneUp</h2>
      <p>Follow <code>docs/NEAR_WALLET_SETUP.md</code> in the repository. The deployment planner lists the accounts, test NEAR allocation and contract setup before any transaction.</p>
      <p>Set <code>ONEUP_PUBLIC_CONFIG</code> to the generated public testnet configuration and run the app. This profile contains contract addresses, never operator or demo keys.</p>
      <p>Run the keeper separately. The oracle and test tokens are still demonstration contracts; connecting a real wallet does not make them production services.</p>
    </div>
    <p className="label">The testnet profile supports wallet-signed contract actions and live contract views. Local account switching, simulated bridges, sponsored sessions, historical activity and rankings are disabled. Use the testnet explorer for transaction history. No testnet deployment is included automatically.</p>
  </main>;
}
