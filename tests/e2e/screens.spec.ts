import { test } from "@playwright/test";

import { chooseFunction, deploy, expectDeployed, openPlayground, run, setEnvironment } from "./helpers";

/** Screenshots for design review: `SCREENSHOTS_DIR=... npx playwright test screens`. */
const dir = process.env.SCREENSHOTS_DIR;
test.skip(!dir, "set SCREENSHOTS_DIR to capture screenshots");

for (const scheme of ["light", "dark"] as const) {
  test(`desktop ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openPlayground(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/desktop-${scheme}-start.png` });
    await deploy(page);
    await expectDeployed(page, "con_demo_token");
    await setEnvironment(page, "Signer", "treasury");
    await chooseFunction(page, "transfer");
    await run(page, { to: "bob", amount: "25" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/desktop-${scheme}-after-call.png` });
    await run(page, { to: "bob", amount: "5000" });
    await page.getByRole("region", { name: "Execute contract" }).getByRole("button", { name: /Maximize/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/desktop-${scheme}-execute-maximized-error.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Activity log/ }).click();
    await page.locator("#environment").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/desktop-${scheme}-environment-log.png`, fullPage: true });
  });

  test(`phone ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await openPlayground(page);
    await deploy(page);
    await expectDeployed(page, "con_demo_token");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/phone-${scheme}.png`, fullPage: true });
  });
}
