import { readdir } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { chooseFunction, deploy, expectDeployed, openPlayground, run } from "./helpers";

for (const scheme of ["light", "dark"] as const) {
  test(`no WCAG 2.1 AA violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openPlayground(page);
    await deploy(page);
    await expectDeployed(page, "con_demo_token");
    await chooseFunction(page, "transfer");
    await run(page, { to: "bob", amount: "5" });
    await page.locator("#environment").getByRole("button", { name: /Execution environment/ }).click();
    await page.getByRole("button", { name: /Activity log/ }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Monaco's hidden input textarea and minimap internals are third-party.
      .exclude(".monaco-editor")
      .analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }))).toEqual([]);
  });
}

test("the main flow works with the keyboard only", async ({ page }) => {
  await openPlayground(page);
  await page.getByRole("button", { name: "Deploy", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expectDeployed(page, "con_demo_token");
  await page.getByRole("button", { name: "Maximize Execute contract panel" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Execute contract" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("reflows at 320 CSS pixels (WCAG 1.4.10)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openPlayground(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlayground(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await deploy(page);
  await expectDeployed(page, "con_demo_token");
});

test("serves the WebAssembly with the right type and long-lived caching", async ({ request }) => {
  const files = await readdir("out/_next/static/wasm");
  expect(files.filter((name) => name.endsWith(".wasm")).length).toBe(2);
  for (const name of files) {
    const response = await request.get(`/_next/static/wasm/${name}`);
    expect(response.headers()["content-type"]).toBe("application/wasm");
    expect(response.headers()["cache-control"]).toContain("immutable");
  }
});
