// SPDX-License-Identifier: GPL-3.0-or-later
/** Pure helpers for the atlas cards: number formatting and literal-digit marking (the v3 rule: characters, not rounding). */
import { literalDigits } from "../v3/wonder-math.mjs";
export { literalDigits };

/** A number as readable text with up to n significant digits and thousands separators. */
export function fmt(v, n = 8) {
  if (v == null || !Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) return v.toExponential(n - 1).replace(/\.?0+e/, "e").replace("e+", " × 10^").replace("e-", " × 10^-");
  return v.toLocaleString("en-US", { maximumSignificantDigits: n, useGrouping: a >= 10000 });
}

/** Split formatted text into [text, isHit] runs: the first k significant digits are hits. */
export function markDigits(text, k) {
  const out = [];
  let seen = 0, started = false;
  for (const ch of text) {
    const digit = ch >= "0" && ch <= "9";
    if (digit && !started && ch === "0") { out.push([ch, null]); continue; }
    if (digit) { started = true; seen++; out.push([ch, seen <= k]); } else out.push([ch, started && seen < k ? true : null]);
    if (/[×e]/.test(ch)) break;
  }
  const rest = [...text].slice(out.length).join("");
  if (rest) out.push([rest, null]);
  // merge runs
  const runs = [];
  for (const [c, h] of out) { const last = runs[runs.length - 1]; if (last && last[1] === h) last[0] += c; else runs.push([c, h]); }
  return runs;
}

/** Filter claims by family, number grade, design grade and a search string. Empty sets mean "all". */
export function filterClaims(claims, { family = new Set(), number = new Set(), design = new Set(), q = "" } = {}) {
  const needle = q.trim().toLowerCase();
  return claims.filter((c) =>
    (!family.size || family.has(c.family)) && (!number.size || number.has(c.number)) && (!design.size || design.has(c.design)) &&
    (!needle || (c.title + " " + c.wonder + " " + c.test + " " + c.source).toLowerCase().includes(needle)));
}

export const NUMBER_GRADES = ["Confirmed", "Likely", "Suspected", "False", "Untested"];
export const DESIGN_GRADES = ["Designed", "Possible", "Coincidence", "Unknown"];
