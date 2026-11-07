"""Behaviour witness for the Loom: the latest browser evidence passed AND still describes these files.
Exit 0 pass, 1 fail (red, stale or missing). Run: python3 -E -s tools/check_browser.py"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
h = lambda p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
runs = sorted((ROOT / "evidence").glob("browser-*.json"))
if not runs:
    print("BROWSER_EVIDENCE_MISSING"); sys.exit(1)
ev = json.loads(runs[-1].read_text())
stale = [p for p, d in ev["page_sources"].items() if h(p) != d] + [c for c, d in ev["case_manifests"].items() if h(f"cases/{c}/case.json") != d]
cases = sorted(p.parent.name for p in (ROOT / "cases").glob("*/case.json"))
missing = sorted(set(cases) - set(ev["case_manifests"]))
# evidence/ is outside the Loom candidate (excluded by name), so print the judged bytes' hash: the witness
# record, and through it the receipt, then pins exactly what passed.
print(json.dumps({"evidence": runs[-1].name, "evidence_sha256": h(f"evidence/{runs[-1].name}"), "pass": ev["pass"],
                  "stale": stale, "cases_not_checked": missing}))
sys.exit(0 if ev["pass"] and not stale and not missing else 1)
