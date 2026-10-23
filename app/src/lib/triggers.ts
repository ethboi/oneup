import { parseTokenAmount } from "@oneup/sdk";

export const priceInput = (text: string) => parseTokenAmount(text, 8) || null;
export function triggerValues(tp: string, sl: string) {
  const takeProfit = priceInput(tp), stopLoss = priceInput(sl);
  if ((tp.trim() && takeProfit === null) || (sl.trim() && stopLoss === null)) return undefined;
  return { takeProfit, stopLoss };
}
/** Exact editable decimal, including the smallest price; never exponent notation. */
export function editablePrice(value: string | null) {
  if (value === null) return "";
  const units = BigInt(value);
  const fraction = (units % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${units / 100000000n}${fraction ? "." + fraction : ""}`;
}
