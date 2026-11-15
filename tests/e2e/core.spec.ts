import { expect, test } from "@playwright/test";

import { chooseFunction, deploy, expectDeployed, openPlayground, panel, replaceCode, run, setEnvironment, stateValue } from "./helpers";
import { DEFAULT_CONTRACT } from "../../src/lib/workspace/model";

test("write, lint, deploy, call and see the result and state", async ({ page }) => {
  await openPlayground(page);
  const write = panel(page, "Write contract");
  await expect(write.getByRole("status").filter({ hasText: "No problems" })).toBeVisible();

  await deploy(page);
  await expectDeployed(page, "con_demo_token");
  await expect(await stateValue(page, "con_demo_token", "balances:treasury")).toContainText("1000");

  await setEnvironment(page, "Signer", "treasury");
  await chooseFunction(page, "transfer");
  const result = await run(page, { to: "bob", amount: "25" });
  await expect(result.getByText("Success")).toBeVisible();
  await expect(result).toContainText(/\d+ chi/);
  await expect(result).toContainText("con_demo_token.balances:bob");
  await expect(await stateValue(page, "con_demo_token", "balances:bob")).toContainText("25");
  await expect(await stateValue(page, "con_demo_token", "balances:treasury")).toContainText("975");

  await chooseFunction(page, "balance_of");
  const balance = await run(page, { account: "bob" });
  await expect(balance.getByTestId("return-value")).toContainText("25");
});

test("shows compiler problems live and contract errors after a failed call", async ({ page }) => {
  await openPlayground(page);
  await deploy(page);
  await chooseFunction(page, "transfer");
  const failed = await run(page, { to: "bob", amount: "5" });
  await expect(failed.getByText("Failed")).toBeVisible();
  await expect(failed.getByTestId("run-error")).toHaveText("Insufficient balance.");

  const invalid = await run(page, { to: "bob", amount: "1.5" });
  await expect(panel(page, "Execute contract").getByText("Enter a whole number such as 25 or -3.")).toBeVisible();
  await expect(invalid.getByTestId("run-error")).toHaveText("Insufficient balance.");

  await replaceCode(page, `${DEFAULT_CONTRACT}\n\n@export\ndef broken(x: float):\n    return x\n`);
  await expect(panel(page, "Write contract").getByRole("list", { name: "Compiler problems" })).toContainText("float");
});

test("keeps decimals and big integers exact end to end", async ({ page }) => {
  await openPlayground(page);
  await page.getByRole("button", { name: "Examples" }).click();
  await page.getByRole("menuitem", { name: /Exact decimals/ }).click();
  await deploy(page);
  await expectDeployed(page, "con_savings");
  await chooseFunction(page, "deposit");
  await run(page, { amount: "0.000000000000000000000000000001", note: "tiny" });
  const stateText = panel(page, "Contract state").getByTestId("state-view");
  await expect(stateText).toContainText('"amount": 0.000000000000000000000000000001');
  await run(page, { amount: "0.1", note: "dime" });
  await expect(stateText).toContainText('"amount": 0.1');

  await chooseFunction(page, "projected");
  const projected = await run(page, { account: "demo", years: "2" });
  await expect(projected.getByTestId("return-value")).toContainText("0.11025");
});

test("persists the workspace across reloads", async ({ page }) => {
  await openPlayground(page);
  await deploy(page);
  await expectDeployed(page, "con_demo_token");
  await page.reload();
  await expect(page.getByRole("button", { name: "Deploy", exact: true })).toBeVisible();
  await expect(await stateValue(page, "con_demo_token", "balances:treasury")).toContainText("1000");
});

test("stops a runaway loop cleanly when metered", async ({ page }) => {
  await openPlayground(page);
  await replaceCode(page, `${DEFAULT_CONTRACT}\n\n@export\ndef spin():\n    i = 0\n    while True:\n        i += 1\n`);
  await deploy(page);
  await expectDeployed(page, "con_demo_token");
  await chooseFunction(page, "spin");
  const result = await run(page, {});
  await expect(result.getByText("Failed")).toBeVisible();
});

test("stops an unmetered runaway loop and keeps the chain", async ({ page }) => {
  test.setTimeout(90_000);
  await openPlayground(page);
  await replaceCode(page, `${DEFAULT_CONTRACT}\n\n@export\ndef spin():\n    i = 0\n    while True:\n        i += 1\n`);
  await deploy(page);
  await expectDeployed(page, "con_demo_token");
  const section = page.locator("#environment");
  await section.getByRole("button", { name: /Execution environment/ }).click();
  await section.getByRole("switch", { name: "Count chi like the chain" }).click();
  await expect(section.getByText(/unmetered/)).toBeVisible();
  await chooseFunction(page, "spin");
  const result = await run(page, {});
  await expect(result.getByTestId("run-error")).toContainText("Stopped after 10 seconds", { timeout: 30_000 });
  await chooseFunction(page, "balance_of");
  const balance = await run(page, { account: "treasury" });
  await expect(balance.getByTestId("return-value")).toContainText("1000");
});
