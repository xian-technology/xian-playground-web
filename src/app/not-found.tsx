import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/favicon.png" alt="Xian Playground logo" className="size-14 rounded-xl" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">This page does not exist. The playground lives on the start page.</p>
      <Link
        href="/"
        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Back to the playground
      </Link>
    </main>
  );
}
