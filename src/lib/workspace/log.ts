/** The activity log: newest first, capped like the old playground (50 entries). */

export const MAX_LOG_ENTRIES = 50;
export const MAX_LOG_DETAIL = 4_000;

export type LogLevel = "info" | "success" | "warning" | "error";

export interface LogEntry {
  id: string;
  /** ISO 8601 timestamp. */
  at: string;
  level: LogLevel;
  action: string;
  message: string;
  detail: string;
}

export interface LogInput {
  level: LogLevel;
  action: string;
  message: string;
  detail?: string;
}

let counter = 0;

export function appendLog(entries: LogEntry[], input: LogInput): LogEntry[] {
  const detail = (input.detail ?? "").trim();
  counter += 1;
  const entry: LogEntry = {
    id: `${Date.now().toString(36)}-${counter.toString(36)}`,
    at: new Date().toISOString(),
    level: input.level,
    action: input.action,
    message: input.message,
    detail: detail.length > MAX_LOG_DETAIL ? `${detail.slice(0, MAX_LOG_DETAIL)}…` : detail,
  };
  return [entry, ...entries].slice(0, MAX_LOG_ENTRIES);
}

/** A short, line-per-key description of how a state map changed. */
export function summarizeStateChanges(
  before: Record<string, string>,
  after: Record<string, string>,
  limit = 5,
): string {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .sort();
  if (keys.length === 0) return "No keys changed.";
  const lines = keys
    .slice(0, limit)
    .map((key) => `${key}: ${before[key] ?? "(unset)"} -> ${after[key] ?? "(deleted)"}`);
  if (keys.length > limit) lines.push(`… and ${keys.length - limit} more changes`);
  return lines.join("\n");
}
