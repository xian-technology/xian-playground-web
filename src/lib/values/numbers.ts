/**
 * Exact numeric input rules of the Xian VM v2 (`xian_vm_v2`).
 *
 * `canonicalDecimal` mirrors `xian_numeric::canonical_decimal` in
 * xian-contracting/packages/xian-numeric: same grammar, same limits, same
 * rendering. Values never pass through a JavaScript `number`.
 */

export const INTEGER_BITS = 512n;
export const DECIMAL_SCALE = 30;
export const DECIMAL_INTEGER_DIGITS = 61;
export const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

const MAX_INTEGER = (1n << INTEGER_BITS) - 1n;
const DECIMAL_GRAMMAR = /^([+-]?)(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?)([0-9]+))?$/;
const INTEGER_GRAMMAR = /^-?(?:0|[1-9][0-9]*)$/;

/** Parse an exact decimal and return the canonical wire spelling. */
export function canonicalDecimal(text: string): string {
  const match = DECIMAL_GRAMMAR.exec(text);
  if (!match) throw new RangeError("invalid decimal spelling");
  const [, sign, whole = "", fraction = "", bareFraction = "", expSign, expDigits] = match;
  const fractionDigits = fraction || bareFraction;
  const digits = whole + fractionDigits;
  const significant = digits.replace(/^0+/, "").replace(/0+$/, "");
  if (significant.length === 0) return "0";
  const leadingZeroes = digits.length - digits.replace(/^0+/, "").length;
  const point = whole.length + exponent(expSign, expDigits, text.length) - leadingZeroes;
  if (point > DECIMAL_INTEGER_DIGITS) {
    throw new RangeError("decimal magnitude must be below 10^61");
  }
  if (significant.length - point > DECIMAL_SCALE) {
    throw new RangeError("decimal requires more than 30 fractional digits");
  }
  return (sign === "-" ? "-" : "") + renderDecimal(significant, point);
}

/** The exponent value, clamped like the Rust parser (larger shifts cannot matter). */
function exponent(sign: string | undefined, digits: string | undefined, inputLength: number): number {
  if (digits === undefined) return 0;
  const limit = inputLength + DECIMAL_INTEGER_DIGITS + DECIMAL_SCALE;
  let value = 0;
  for (const digit of digits) {
    value = Math.min(value * 10 + Number(digit), limit);
  }
  return sign === "-" ? -value : value;
}

function renderDecimal(significant: string, point: number): string {
  if (point <= 0) return `0.${"0".repeat(-point)}${significant}`;
  if (point >= significant.length) return significant + "0".repeat(point - significant.length);
  return `${significant.slice(0, point)}.${significant.slice(point)}`;
}

/** Parse a canonical integer spelling (`-?(0|[1-9][0-9]*)`, at most 512 bits). */
export function parseInteger(text: string): bigint {
  if (text.length > 156 || !INTEGER_GRAMMAR.test(text) || text === "-0") {
    throw new RangeError("invalid integer spelling");
  }
  const value = BigInt(text);
  if (value > MAX_INTEGER || value < -MAX_INTEGER) {
    throw new RangeError("integer exceeds 512 bits");
  }
  return value;
}

export function isSafeInteger(value: bigint): boolean {
  return value >= -MAX_SAFE_INTEGER && value <= MAX_SAFE_INTEGER;
}
