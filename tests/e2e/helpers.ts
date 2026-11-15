import { expect, type Locator, type Page } from "@playwright/test";

export async function openPlayground(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Deploy", exact: true })).toBeVisible();
}

export const panel = (page: Page, title: string): Locator => page.getByRole("region", { name: title });

export async function deploy(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Deploy", exact: true }).click();
}

export async function setEnvironment(page: Page, label: string, value: string): Promise<void> {
  const section = page.locator("#environment");
  const toggle = section.getByRole("button", { name: /Execution environment/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await section.getByLabel(label, { exact: true }).fill(value);
  await section.getByRole("button", { name: "Apply changes" }).click();
  await expect(section.getByRole("button", { name: "Apply changes" })).toBeDisabled();
}

export async function chooseFunction(page: Page, name: string): Promise<void> {
  const execute = panel(page, "Execute contract");
  await execute.getByRole("combobox", { name: "Function" }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

export async function run(page: Page, fields: Record<string, string>): Promise<Locator> {
  const execute = panel(page, "Execute contract");
  for (const [name, value] of Object.entries(fields)) {
    await execute.getByLabel(name, { exact: true }).fill(value);
  }
  await execute.getByRole("button", { name: "Run", exact: true }).click();
  return execute.getByTestId("run-result");
}

export async function stateValue(page: Page, contract: string, key: string): Promise<Locator> {
  const state = panel(page, "Contract state").getByRole("region", { name: `${contract} state` });
  return state.locator("dt", { hasText: new RegExp(`^${key.replace(/[:.]/g, "\\$&")}$`) }).locator("xpath=following-sibling::dd[1]");
}

/** Replace the editor contents by pasting (typing would trigger auto-indent and auto-close). */
export async function replaceCode(page: Page, code: string): Promise<void> {
  const editor = panel(page, "Write contract").getByTestId("code-editor");
  await editor.locator(".view-lines").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.evaluate((text) => navigator.clipboard.writeText(text), code);
  await page.keyboard.press("ControlOrMeta+V");
}

export async function expectDeployed(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(`Deployed ${name}.`)).toBeVisible();
  await expect(panel(page, "Execute contract").getByRole("combobox", { name: "Contract" })).toHaveText(name);
}
