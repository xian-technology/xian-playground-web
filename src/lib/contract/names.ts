/**
 * Contract name rules of the `submission` contract (see
 * xian-contracting `contracting.names` and the old playground's deploy check).
 */

export const MAX_CONTRACT_NAME_LENGTH = 64;
export const SYSTEM_SIGNER = "sys";
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** A user-facing reason the name cannot be deployed, or null when it can. */
export function contractNameError(name: string, signer: string): string | null {
  if (name === "") return "Enter a contract name.";
  if (name === "submission") return "The name “submission” is reserved.";
  const requirePrefix = signer !== SYSTEM_SIGNER;
  if (!SAFE_NAME.test(name) || (requirePrefix && !name.startsWith("con_"))) {
    return requirePrefix
      ? "Use con_ followed by lowercase letters, digits or underscores (64 characters max)."
      : "Start with a lowercase letter; use lowercase letters, digits or underscores (64 characters max).";
  }
  return null;
}

/** System contracts are the ones without the user `con_` prefix. */
export function isSystemContract(name: string): boolean {
  return !name.startsWith("con_");
}
