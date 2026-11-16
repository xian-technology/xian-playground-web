import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get, type IncomingMessage } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

async function unusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (address === null || typeof address === "string") throw new Error("No local test port.");
  await new Promise<void>((done) => probe.close(() => done()));
  return address.port;
}

function request(port: number, path: string): Promise<IncomingMessage> {
  return new Promise((resolveResponse, reject) => {
    get({ hostname: "127.0.0.1", port, path }, (response) => {
      response.resume();
      response.on("end", () => resolveResponse(response));
    }).on("error", reject);
  });
}

it("rejects malformed URI escapes without stopping the static preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "xian-static-preview-"));
  await writeFile(join(root, "index.html"), "preview");
  await writeFile(join(root, "404.html"), "not found");
  const port = await unusedPort();
  // Normal shutdown lets Node's child-process coverage flush the HTTP handler.
  const shutdown = "data:text/javascript,process.on('SIGTERM',()=>process.exit(0))";
  const child = spawn(process.execPath, ["--import", shutdown, resolve("scripts/serve-static.mjs"), root], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => { throw new Error("Static preview failed to start."); }),
    ]);
    expect((await request(port, "/")).statusCode).toBe(200);
    expect((await request(port, "/index.html")).statusCode).toBe(200);
    expect((await request(port, "/missing")).statusCode).toBe(404);
    expect((await request(port, "/%E0%A4")).statusCode).toBe(400);
    expect((await request(port, "/")).statusCode).toBe(200);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  }
});
