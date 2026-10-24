import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { OneUp, type Deployment } from "@oneup/sdk";
const fixture = JSON.parse(readFileSync(process.env.ONEUP_BROWSER_FIXTURE!, "utf8")) as {
  appUrl: string; rpcUrl: string; contracts: Deployment["contracts"];
  seller: string; buyer: string; tokenId: string; askingPriceUsdc: string;
};
// This client only reads chain state. Every listing, purchase and claim below is submitted by the rendered app.
const o = new OneUp({ network: "localnet", rpcUrl: fixture.rpcUrl, contracts: fixture.contracts } as Deployment);
async function withdrawn() { const life = (await o.lifeInfo(fixture.tokenId))!; return BigInt(life.paid) - BigInt(life.claimable); }
const lifePath = `/extra-lives#life=${encodeURIComponent(fixture.tokenId)}`;
async function switchAccount(page: Page, account: string) {
  await page.getByRole("button", { name: "Demo tools", exact: true }).click();
  await page.getByRole("combobox", { name: "Account", exact: true }).selectOption(account);
}

test("a buyer receives the Life and claims its USDC; the seller loses claim controls", async ({ page }) => {
  await page.goto(lifePath);
  await page.getByRole("button", { name: "ENTER", exact: true }).click();
  await switchAccount(page, fixture.seller);
  await expect(page.getByText(`${fixture.seller} (you)`, { exact: false })).toBeVisible();
  await expect(page.getByText("Available to claim", { exact: true })).toBeVisible();
  await expect(page.getByText("Remaining payout limit", { exact: true })).toBeVisible();
  await expect(page.getByText("Maximum additional USDC. Future payouts may be zero.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "List for sale", exact: true }).click();
  await page.getByRole("textbox", { name: "Price in USDC", exact: true }).fill(fixture.askingPriceUsdc);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByText(`Listed for $${fixture.askingPriceUsdc}`, { exact: true })).toBeVisible();
  await expect.poll(async () => (await o.listings()).some(listing => listing.token_id === fixture.tokenId && listing.seller === fixture.seller)).toBe(true);

  await switchAccount(page, fixture.buyer);
  await page.goto("/market");
  const listing = page.getByText(`Token ${fixture.tokenId}`, { exact: true }).locator("..").locator("..");
  await expect(listing.getByText("Asking price", { exact: true })).toBeVisible();
  await expect(listing.getByText("Available to claim", { exact: true })).toBeVisible();
  await expect(listing.getByText("Remaining payout limit", { exact: true })).toBeVisible();
  await listing.getByRole("button", { name: "Buy", exact: true }).click();
  await expect.poll(async () => (await o.lifeInfo(fixture.tokenId))?.owner_id).toBe(fixture.buyer);

  await page.goto(lifePath);
  await expect(page.getByText(`${fixture.buyer} (you)`, { exact: false })).toBeVisible();
  const before = BigInt(await o.usdcBalance(fixture.buyer));
  const withdrawnBefore = await withdrawn();
  await page.getByRole("button", { name: /^Claim \$/ }).click();
  await expect.poll(async () => BigInt(await o.usdcBalance(fixture.buyer)) > before).toBe(true);
  await expect.poll(async () => await withdrawn() > withdrawnBefore).toBe(true);
  await page.reload();
  await expect(page.getByText(`${fixture.buyer} (you)`, { exact: false })).toBeVisible();

  await switchAccount(page, fixture.seller);
  await expect(page.getByText(`This Life belongs to ${fixture.buyer}.`, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Claim \$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "List for sale", exact: true })).toHaveCount(0);
  expect((await o.lifeInfo(fixture.tokenId))?.owner_id).toBe(fixture.buyer);
});

// Public onboarding must work before a tester connects a wallet or supplies an account.
test("wallet setup explains the testnet path without requiring a connected account", async ({ page }) => {
  await page.goto("/wallet-setup");
  await expect(page.getByRole("heading", { name: /NEAR wallet/i }).first()).toBeVisible();
  await expect(page.getByText(/testnet/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /wallet/i }).first()).toBeVisible();
});
