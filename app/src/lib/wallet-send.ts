import type { NearWalletBase } from "@hot-labs/near-connect";
import { getTransactionLastResult, teraToGas } from "near-api-js";
import type { Send } from "@oneup/sdk";

export type SigningWallet = Pick<NearWalletBase, "getAccounts" | "signAndSendTransaction">;
export interface WalletSendOptions {
  /** The account that the UI operation was created for, never a live account getter. */
  accountId: string;
  /** Shared across sender instances/renders and connect/disconnect operations. */
  lock: { busy: boolean };
  /** Query the configured RPC with waitUntil: "FINAL"; do not broadcast again. */
  confirm?: (transactionHash: string, signerId: string) => Promise<unknown>;
}
interface Outcome {
  status?: unknown;
  final_execution_status?: unknown;
  transaction?: { hash?: unknown; signer_id?: unknown; receiver_id?: unknown };
  transaction_outcome?: { id?: unknown };
  receipts_outcome?: { outcome: { status?: unknown } }[];
}
function outcomeObject(value: unknown): Outcome {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The wallet has not confirmed this transaction. Check your wallet before trying again.");
  return value as Outcome;
}

/** A wallet cancellation, redirect or failed receipt must never be shown as a completed action. */
export function walletResult<T>(outcome: unknown): T {
  const out = outcomeObject(outcome);
  if (out.final_execution_status !== undefined && out.final_execution_status !== "FINAL")
    throw new Error("The transaction is still pending. Check your wallet before trying again.");
  const failed = [out.status, ...(out.receipts_outcome ?? []).map(r => r.outcome.status)]
    .find(s => s && typeof s === "object" && "Failure" in s);
  if (failed) throw new Error("The transaction failed: " + JSON.stringify((failed as { Failure: unknown }).Failure));
  if (!out.status || typeof out.status !== "object" || !("SuccessValue" in out.status) || typeof out.status.SuccessValue !== "string")
    throw new Error("The transaction is still pending. Check your wallet before trying again.");
  return getTransactionLastResult(outcome as Parameters<typeof getTransactionLastResult>[0]) as T;
}

function checkTransaction(outcome: unknown, signer: string, receiver: string, expectedHash?: string): string | undefined {
  const out = outcomeObject(outcome);
  const tx = out.transaction;
  if (tx?.signer_id !== undefined && tx.signer_id !== signer)
    throw new Error("The wallet returned a transaction for a different signer. Check your wallet before trying again.");
  if (tx?.receiver_id !== undefined && tx.receiver_id !== receiver)
    throw new Error("The wallet returned a transaction for a different contract. Check your wallet before trying again.");
  const transactionHash = typeof tx?.hash === "string" && tx.hash ? tx.hash : undefined;
  const outcomeHash = typeof out.transaction_outcome?.id === "string" && out.transaction_outcome.id ? out.transaction_outcome.id : undefined;
  if (transactionHash && outcomeHash && transactionHash !== outcomeHash)
    throw new Error("The returned transaction hashes do not match. Check your wallet before trying again.");
  const hash = transactionHash ?? outcomeHash;
  if (expectedHash && hash !== expectedHash)
    throw new Error("The confirmed transaction hash does not match the wallet request. Check your wallet before trying again.");
  return hash;
}

export function walletSender(
  getWallet: () => Promise<SigningWallet>, currentAccount: () => string,
  allowedContracts: ReadonlySet<string>, options: WalletSendOptions,
): Send {
  const accountId = options.accountId;
  const assertAccount = () => {
    if (!accountId) throw new Error("Connect your NEAR testnet wallet first");
    if (currentAccount() !== accountId)
      throw new Error("Your wallet account changed. Check any pending transaction before trying again.");
  };
  return async <T>(call: Parameters<Send>[0]): Promise<T> => {
    assertAccount();
    if (!allowedContracts.has(call.contractId)) throw new Error("This contract is not part of the configured OneUp deployment");
    if ((call.deposit ?? 0n) < 0n) throw new Error("Invalid transaction deposit");
    if (options.lock.busy) throw new Error("Another wallet request is pending. Finish it before starting a new one.");
    options.lock.busy = true;
    try {
      const wallet = await getWallet();
      assertAccount();
      const accounts = await wallet.getAccounts({ network: "testnet" });
      assertAccount();
      if (!accounts.some(a => a.accountId === accountId)) throw new Error("Your wallet account changed. Review the action and try again.");
      const outcome = await wallet.signAndSendTransaction({
        network: "testnet",
        signerId: accountId,
        receiverId: call.contractId,
        actions: [{
          type: "FunctionCall",
          params: {
            methodName: call.methodName,
            args: call.args,
            gas: (call.gas ?? teraToGas("100")).toString(),
            deposit: (call.deposit ?? 0n).toString(),
          },
        }],
      });
      assertAccount();
      const hash = checkTransaction(outcome, accountId, call.contractId);
      if (!options.confirm) return walletResult<T>(outcome);
      if (!hash) throw new Error("The wallet returned no transaction hash to confirm. Check your wallet before trying again.");
      const confirmed = await options.confirm(hash, accountId);
      assertAccount();
      checkTransaction(confirmed, accountId, call.contractId, hash);
      if (outcomeObject(confirmed).final_execution_status !== "FINAL")
        throw new Error("The transaction is still pending. Check your wallet before trying again.");
      return walletResult<T>(confirmed);
    } finally {
      options.lock.busy = false;
    }
  };
}
