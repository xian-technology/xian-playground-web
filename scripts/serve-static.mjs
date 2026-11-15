// Minimal static file server for the exported app (`out/`), used by the
// Playwright suite and for local previews. Serves `.wasm` with the
// `application/wasm` type that streaming WebAssembly compilation requires.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "out");
const port = Number(process.env.PORT ?? 3210);
const host = process.env.HOST ?? "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0]));
  const candidate = join(root, clean);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  for (const path of [candidate, `${candidate}.html`, join(candidate, "index.html")]) {
    try {
      if (statSync(path).isFile()) return path;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

createServer((req, res) => {
  const file = resolveFile(req.url ?? "/");
  const target = file ?? join(root, "404.html");
  res.writeHead(file ? 200 : 404, {
    "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
  });
  createReadStream(target).pipe(res);
}).listen(port, host, () => {
  console.log(`serving ${root} on http://${host}:${port}`);
});
