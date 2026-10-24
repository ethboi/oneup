import { test } from "node:test";
import assert from "node:assert/strict";
import type { NearWalletBase } from "@hot-labs/near-connect";
import { assertTestnetWallet, signedInAccount, walletOptions } from "../src/lib/wallet-config.ts";

const wallet = (id = "meteor-wallet", features: Record<string, boolean> = {
  testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true,
}) => ({ manifest: { id, features } }) as unknown as Pick<NearWalletBase, "manifest">;

test("wallet selection requires testnet and account-only connection without adding an access key", () => {
  const options = walletOptions("https://rpc.testnet.near.org");
  assert.deepEqual(options, {
    network: "testnet",
    providers: { testnet: ["https://rpc.testnet.near.org"] },
    features: { testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true },
    excludedWallets: ["mynearwallet", "ethereum-wallets"],
    autoConnect: false,
  });
  assert.equal("signIn" in options, false, "deprecated signIn options would request an access key");
  assert.equal("addFunctionCallKey" in options, false);
  assert.equal("signMessageParams" in options, false);
});

test("selected wallets must support the same network and capabilities as the picker", () => {
  assert.doesNotThrow(() => assertTestnetWallet(wallet()));
  for (const missing of ["testnet", "signInWithoutAddKey", "signAndSendTransaction"]) {
    const features = { ...wallet().manifest.features };
    delete (features as unknown as Record<string, boolean>)[missing];
    assert.throws(() => assertTestnetWallet(wallet("candidate", features)), /supports NEAR testnet/);
    assert.throws(() => assertTestnetWallet(wallet("candidate", { ...features, [missing]: false })), /supports NEAR testnet/);
  }
  assert.throws(() => assertTestnetWallet(wallet("mynearwallet")), /being retired/);
  assert.throws(() => assertTestnetWallet(wallet("ethereum-wallets")), /native NEAR wallets/);
});

test("only a successful sign-in for one chosen account may identify the connected user", () => {
  assert.equal(signedInAccount({ success: true, accounts: [{ accountId: "chosen.testnet" }] }), "chosen.testnet");
  for (const event of [
    { success: false, accounts: [{ accountId: "chosen.testnet" }] },
    { success: true, accounts: [] },
    { success: true, accounts: [{ accountId: "" }] },
    { success: true, accounts: [{ accountId: "remembered.testnet" }, { accountId: "chosen.testnet" }] },
  ]) assert.throws(() => signedInAccount(event), /exactly one/);
});
