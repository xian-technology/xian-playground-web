/**
 * Share links: the portable workspace, deflate-compressed and base64url
 * encoded into the URL fragment (`#w=...`). The fragment never reaches a
 * server, so a link works on any static host and leaks nothing to it.
 */

import { parseWorkspaceDoc, type WorkspaceDoc } from "./model";

export const SHARE_PREFIX = "#w=";
/** Longest fragment we create; longer workspaces go through Export instead. */
export const MAX_SHARE_FRAGMENT_CHARS = 32_000;
/** Inflated size cap when reading a link (guards against compression bombs). */
export const MAX_SHARE_JSON_BYTES = 2 * 1024 * 1024;

export class ShareLinkError extends Error {}

const DAMAGED = "This share link is damaged or incomplete. Check that you copied all of it, or ask for a new one.";

export async function encodeShareFragment(doc: WorkspaceDoc): Promise<string> {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream("deflate-raw"));
  const fragment = SHARE_PREFIX + toBase64Url(bytes);
  if (fragment.length > MAX_SHARE_FRAGMENT_CHARS) {
    throw new ShareLinkError("This workspace is too large for a link. Use Export to share it as a file.");
  }
  return fragment;
}

/** The workspace in `hash`, null when the hash is not a share link. */
export async function decodeShareFragment(hash: string): Promise<WorkspaceDoc | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  const encoded = hash.slice(SHARE_PREFIX.length);
  if (hash.length > MAX_SHARE_FRAGMENT_CHARS) throw new ShareLinkError("This share link is too large to open.");
  let text: string;
  try {
    const bytes = await inflateCapped(fromBase64Url(encoded));
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ShareLinkError) throw error;
    throw new ShareLinkError(DAMAGED);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ShareLinkError(DAMAGED);
  }
  return parseWorkspaceDoc(data);
}

async function pipe(bytes: Uint8Array, transform: CompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateCapped(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_SHARE_JSON_BYTES) {
      await reader.cancel();
      throw new ShareLinkError("This share link is too large to open.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new ShareLinkError(DAMAGED);
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
