import { test } from "node:test";
import assert from "node:assert/strict";
import { walletSender, walletResult, type SigningWallet, type WalletSendOptions } from "../src/lib/wallet-send.ts";

const alice = "alice.testnet";
const bob = "bob.testnet";
const allowed = new Set(["house.project.testnet", "usdc.project.testnet"]);
const call = { contractId: "usdc.project.testnet", methodName: "ft_transfer_call", args: { receiver_id: "house.project.testnet", amount: "900719925474099312345" }, deposit: 1n, gas: 300000000000000n };
const success = (value: unknown) => ({
  status: { SuccessValue: Buffer.from(JSON.stringify(value)).toString("base64") }, receipts_outcome: [],
  final_execution_status: "FINAL", transaction: { hash: "transaction-1", signer_id: alice, receiver_id: call.contractId },
});
const options = (extra: Partial<WalletSendOptions> = {}): WalletSendOptions => ({ accountId: alice, lock: { busy: false }, ...extra });
const fakeWallet = (sign: (tx: any) => Promise<unknown>): SigningWallet => ({
  getAccounts: async () => [{ accountId: alice }], signAndSendTransaction: sign,
}) as unknown as SigningWallet;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("external wallet transfer preserves exact amount, gas, deposit and signer and decodes the confirmed receipt", async () => {
  let sent: any;
  const wallet = fakeWallet(async tx => { sent = tx; return success("ok"); });
  wallet.getAccounts = async request => {
    assert.deepEqual(request, { network: "testnet" });
    return [{ accountId: bob }, { accountId: alice }];
  };
  const send = walletSender(async () => wallet, () => alice, allowed, options());
  assert.equal(await send(call), "ok");
  assert.equal(sent.signerId, alice);
  assert.equal(sent.network, "testnet");
  assert.equal(sent.receiverId, call.contractId);
  assert.equal(sent.actions.length, 1);
  assert.equal(sent.actions[0].type, "FunctionCall");
  const action = sent.actions[0].params;
  assert.equal(action.methodName, call.methodName);
  assert.equal(action.deposit, "1");
  assert.equal(action.gas, call.gas.toString());
  assert.deepEqual(action.args, call.args);
});

test("disconnect, account changes during wallet acquisition, and unknown receivers never request a signature", async () => {
  let requests = 0;
  let account = "";
  const wallet = fakeWallet(async () => { requests++; return success(null); });
  const disconnected = walletSender(async () => wallet, () => account, allowed, options({ accountId: "" }));
  await assert.rejects(disconnected(call), /Connect/);
  account = alice;
  const send = walletSender(async () => wallet, () => account, allowed, options());
  await assert.rejects(send({ ...call, contractId: "unrelated.testnet" }), /configured/);
  const switching = walletSender(async () => { account = bob; return wallet; }, () => account, allowed, options());
  await assert.rejects(switching(call), /changed/);
  assert.equal(requests, 0);
});

test("a multi-step operation bound to the old account cannot resume using a new wallet", async () => {
  let account = alice;
  let requests = 0;
  const wallet = fakeWallet(async () => { requests++; return success("first step"); });
  const oldSend = walletSender(async () => wallet, () => account, allowed, options());
  assert.equal(await oldSend(call), "first step");
  // The UI can rerender for Bob while an earlier async action still holds oldSend.
  account = bob;
  await assert.rejects(oldSend({ ...call, args: { account_id: alice } }), /changed/);
  assert.equal(requests, 1);
});

test("a shared lock rejects concurrent requests across sender instances and releases after cancellation", async () => {
  const lock = { busy: false };
  const inWallet = deferred<void>();
  const answer = deferred<unknown>();
  let requests = 0;
  const wallet = fakeWallet(async () => { requests++; inWallet.resolve(); return answer.promise; });
  const first = walletSender(async () => wallet, () => alice, allowed, options({ lock }));
  const rerendered = walletSender(async () => wallet, () => alice, allowed, options({ lock }));
  const pending = first(call);
  await inWallet.promise;
  assert.equal(lock.busy, true);
  await assert.rejects(rerendered(call), /Another wallet request/);
  assert.equal(requests, 1);
  answer.reject(new Error("User rejected"));
  await assert.rejects(pending, /User rejected/);
  assert.equal(lock.busy, false);
  const retry = walletSender(async () => fakeWallet(async () => success("retry")), () => alice, allowed, options({ lock }));
  assert.equal(await retry(call), "retry");
});

test("account changes while requesting accounts or awaiting the signature reject stale results", async () => {
  let account = alice;
  let signatures = 0;
  const wallet = fakeWallet(async () => { signatures++; account = bob; return success("sent"); });
  const state = options();
  await assert.rejects(walletSender(async () => wallet, () => account, allowed, state)(call), /changed/);
  assert.equal(signatures, 1);
  assert.equal(state.lock.busy, false);
  account = alice;
  const switching = { ...wallet, getAccounts: async () => { account = bob; return [{ accountId: alice }]; } } as SigningWallet;
  await assert.rejects(walletSender(async () => switching, () => account, allowed, options())(call), /changed/);
  assert.equal(signatures, 1, "account lookup changes must stop before requesting a signature");
});

test("confirmation waits for the exact returned hash and keeps the signing lock until FINAL", async () => {
  const waiting = deferred<void>();
  const confirmed = deferred<unknown>();
  const lock = { busy: false };
  const wallet = fakeWallet(async () => ({ ...success("optimistic"), final_execution_status: "EXECUTED_OPTIMISTIC" }));
  const send = walletSender(async () => wallet, () => alice, allowed, options({ lock, confirm: async (hash, signer) => {
    assert.equal(hash, "transaction-1"); assert.equal(signer, alice); waiting.resolve(); return confirmed.promise;
  } }));
  const pending = send(call);
  await waiting.promise;
  assert.equal(lock.busy, true);
  await assert.rejects(send(call), /Another wallet request/);
  confirmed.resolve(success("final result"));
  assert.equal(await pending, "final result");
  assert.equal(lock.busy, false);
});

test("confirmation rejects pending outcomes, failed receipts, mismatched transactions and stale accounts", async () => {
  let account = alice;
  const wallet = fakeWallet(async () => success("wallet result"));
  for (const [result, error] of [
    [{ ...success(null), final_execution_status: "EXECUTED" }, /pending/],
    [{ ...success(null), receipts_outcome: [{ outcome: { status: { Failure: "Receiver failed" } } }] }, /Receiver failed/],
    [{ ...success(null), transaction: { ...success(null).transaction, hash: "wrong-hash" } }, /hash/],
    [{ ...success(null), transaction: { ...success(null).transaction, signer_id: bob } }, /signer/],
    [{ ...success(null), transaction: { ...success(null).transaction, receiver_id: "wrong.testnet" } }, /contract/],
  ] as const) {
    const state = options({ confirm: async () => result });
    await assert.rejects(walletSender(async () => wallet, () => account, allowed, state)(call), error);
    assert.equal(state.lock.busy, false);
  }
  const switching = options({ confirm: async () => { account = bob; return success("old-account result"); } });
  await assert.rejects(walletSender(async () => wallet, () => account, allowed, switching)(call), /changed/);
  assert.equal(switching.lock.busy, false);
});

test("incorrect initial transaction identity and missing confirmation hash do not proceed to RPC confirmation", async () => {
  let confirmations = 0;
  const state = options({ confirm: async () => { confirmations++; return success("confirmed"); } });
  for (const result of [
    { ...success(null), transaction: { ...success(null).transaction, signer_id: bob } },
    { ...success(null), transaction: { ...success(null).transaction, receiver_id: "wrong.testnet" } },
    { ...success(null), transaction_outcome: { id: "inconsistent-hash" } },
    { ...success(null), transaction: undefined },
  ]) {
    await assert.rejects(walletSender(async () => fakeWallet(async () => result), () => alice, allowed, state)(call));
  }
  assert.equal(confirmations, 0);
  assert.equal(state.lock.busy, false);
});

test("wallet cancellation and failed or unfinished receipts cannot report success", async () => {
  const wallet = fakeWallet(async () => { throw new Error("User rejected"); });
  await assert.rejects(walletSender(async () => wallet, () => alice, allowed, options())(call), /User rejected/);
  assert.throws(() => walletResult(undefined), /not confirmed/);
  assert.throws(() => walletResult({ status: "Unknown" }), /pending/);
  assert.throws(() => walletResult({ ...success(null), final_execution_status: "EXECUTED_OPTIMISTIC" }), /pending/);
  assert.throws(() => walletResult({ status: { Failure: { ActionError: "Not your token" } } }), /Not your token/);
  assert.throws(() => walletResult({ ...success(null), receipts_outcome: [{ outcome: { status: { Failure: "Receiver failed" } } }] }), /Receiver failed/);
});
