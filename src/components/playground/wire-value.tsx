"use client";

import { Badge } from "@/components/ui/badge";
import { describeWire, formatInline, type DisplayValue } from "@/lib/values/display";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  int: "int",
  decimal: "decimal",
  str: "str",
  bool: "bool",
  null: "None",
  datetime: "datetime",
  timedelta: "timedelta",
  bytes: "bytes",
  bytearray: "bytearray",
  raw: "raw",
  list: "list",
  set: "set",
  frozenset: "frozenset",
  dict: "dict",
};

function typeOf(value: DisplayValue): string {
  return value.kind === "scalar" ? value.type : value.kind === "list" ? value.type : "dict";
}

/** A wire value shown exactly (decimals and big ints digit for digit) with its type. */
export function WireValue({ text, className, showType = true }: { text: string; className?: string; showType?: boolean }) {
  const value = describeWire(text);
  const type = typeOf(value);
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-2", className)}>
      <code className="min-w-0 font-mono text-[0.8rem] break-all whitespace-pre-wrap">{formatInline(value)}</code>
      {showType && type !== "null" && (
        <Badge variant="type" className="shrink-0">
          {TYPE_LABEL[type] ?? type}
        </Badge>
      )}
    </span>
  );
}
