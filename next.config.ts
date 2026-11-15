import type { NextConfig } from "next";

/**
 * A static export: the compiler and the VM run in the browser as
 * WebAssembly, so the build is plain files any static host can serve.
 * Webpack (not Turbopack) because the sibling `@xian-tech/*` packages are
 * wasm-bindgen `bundler` builds that need `asyncWebAssembly`.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.output.environment = { ...config.output.environment, asyncFunction: true };
    return config;
  },
};

export default nextConfig;
