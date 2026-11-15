import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { chooseFunction, deploy, expectDeployed, openPlayground, run, setEnvironment, stateValue } from "./helpers";

async function buildWorkspace(page: Page): Promise<void> {
  await openPlayground(page);
  await deploy(page);
  await expectDeployed(page, "con_demo_token");
  await setEnvironment(page, "Signer", "treasury");
  await chooseFunction(page, "transfer");
  await run(page, { to: "bob", amount: "123456789012345678901234567890" });
}

test("a share link opens the same workspace in a fresh browser", async ({ page, browser }) => {
  await buildWorkspace(page);
  // The transfer above fails (treasury holds 1000) and shows the exact amount it refused; move a small amount instead.
  await run(page, { to: "bob", amount: "40" });
  await expect(await stateValue(page, "con_demo_token", "balances:bob")).toContainText("40");

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText("Share link copied.")).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#w=[A-Za-z0-9_-]+$/);

  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await fresh.newPage();
  await other.goto(link);
  await other.getByRole("button", { name: "Open share link" }).click();
  await expect(other.getByRole("region", { name: /Notifications/ }).getByText("Opened the share link.")).toBeVisible();
  await expect(await stateValue(other, "con_demo_token", "balances:bob")).toContainText("40");
  await expect(await stateValue(other, "con_demo_token", "balances:treasury")).toContainText("960");
  expect(other.url()).not.toContain("#w=");
  await fresh.close();
});

test("a damaged share link is refused without touching the workspace", async ({ page }) => {
  await openPlayground(page, "/#w=not-a-valid-payload");
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(/damaged or incomplete/)).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("export and import a workspace file", async ({ page, browser }) => {
  await buildWorkspace(page);
  await run(page, { to: "carol", amount: "7" });
  await page.getByRole("button", { name: "More workspace actions" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export workspace" }).click();
  const file = await (await downloading).path();
  const exported = JSON.parse(await readFile(file, "utf8"));
  expect(exported.format).toBe("xian-playground-workspace");
  expect(exported.environment.signer).toBe("treasury");

  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await fresh.newPage();
  await openPlayground(other);
  await other.getByRole("button", { name: "More workspace actions" }).click();
  const choosing = other.waitForEvent("filechooser");
  await other.getByRole("menuitem", { name: /Import workspace/ }).click();
  await (await choosing).setFiles(file);
  await other.getByRole("button", { name: "Open file" }).click();
  await expect(await stateValue(other, "con_demo_token", "balances:carol")).toContainText("7");
  await fresh.close();
});
