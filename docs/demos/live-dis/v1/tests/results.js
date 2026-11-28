// results.js: tests call record(name, data) to keep their numbers. When the environment variable
// LIVE_DIS_RESULTS names a directory, each record is written there as <name>.json so that make-receipt.js can
// assemble RECEIPT.json. Without the variable nothing is written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function record(name, data) {
  const dir = process.env.LIVE_DIS_RESULTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 1));
}
