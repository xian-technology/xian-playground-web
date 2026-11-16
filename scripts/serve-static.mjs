// Minimal static file server for the exported app (`out/`), used by the
// Playwright suite and for local previews. Serves `.wasm` with the
// `application/wasm` type that streaming WebAssembly compilation requires,
// and the cache headers a production host should send.
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

function resolveFile(decodedPath) {
  const clean = normalize(decodedPath);
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
  let requestPath;
  try {
    requestPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Malformed request URI.");
    return;
  }
  const file = resolveFile(requestPath);
  const target = file ?? join(root, "404.html");
  // Hashed build assets never change: cache them for a year, like production hosts should.
  const immutable = file !== null && file.includes(`${sep}_next${sep}static${sep}`);
  res.writeHead(file ? 200 : 404, {
    "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(target).pipe(res);
}).listen(port, host, () => {
  console.log(`serving ${root} on http://${host}:${port}`);
});
