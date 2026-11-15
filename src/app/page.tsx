"use client";

import dynamic from "next/dynamic";

/** The playground runs entirely in the browser (WebAssembly compiler and VM, Monaco). */
const PlaygroundApp = dynamic(
  async () => {
    await import("@/components/playground/monaco-setup");
    return (await import("@/components/playground/playground-app")).PlaygroundApp;
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground" role="status">
        Loading the playground…
      </div>
    ),
  },
);

export default function Home() {
  return <PlaygroundApp />;
}
