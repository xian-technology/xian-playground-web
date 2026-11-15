import { describe, expect, it } from "vitest";

import { defaultWorkspace } from "@/lib/workspace/model";
import { decodeShareFragment, encodeShareFragment, MAX_SHARE_FRAGMENT_CHARS, SHARE_PREFIX } from "@/lib/workspace/share";

async function deflate(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return Buffer.from(bytes).toString("base64url");
}

describe("share links", () => {
  it("round trips a workspace through the URL fragment", async () => {
    const ws = defaultWorkspace();
    ws.contracts.push({ name: "con_demo_token", source: ws.editor.code, constructorKwargs: "{}", state: [["balances:treasury", "1000"]] });
    const fragment = await encodeShareFragment(ws);
    expect(fragment.startsWith(SHARE_PREFIX)).toBe(true);
    expect(fragment).toMatch(/^#w=[A-Za-z0-9_-]+$/);
    expect(await decodeShareFragment(fragment)).toEqual(ws);
  });

  it("refuses to build links that are too long", async () => {
    const ws = defaultWorkspace();
    let seed = 1;
    ws.editor.code = Array.from({ length: 120_000 }, () => String.fromCharCode(33 + ((seed = (seed * 48271) % 2147483647) % 90))).join("");
    await expect(encodeShareFragment(ws)).rejects.toThrow(/too large for a link/);
  });

  it("returns null when the fragment is not a share link", async () => {
    expect(await decodeShareFragment("")).toBeNull();
    expect(await decodeShareFragment("#other")).toBeNull();
  });

  it("rejects garbage, oversized and malicious payloads", async () => {
    await expect(decodeShareFragment("#w=%%%")).rejects.toThrow(/damaged/);
    await expect(decodeShareFragment("#w=" + "A".repeat(MAX_SHARE_FRAGMENT_CHARS))).rejects.toThrow(/too large/);
    await expect(decodeShareFragment("#w=" + (await deflate("not json")))).rejects.toThrow(/damaged/);
    await expect(decodeShareFragment("#w=" + (await deflate('{"format":"evil"}')))).rejects.toThrow(/not a playground workspace/);
    // A small payload that inflates far beyond the cap (zip bomb).
    await expect(decodeShareFragment("#w=" + (await deflate(" ".repeat(8 * 1024 * 1024))))).rejects.toThrow(/too large/);
  });
});
