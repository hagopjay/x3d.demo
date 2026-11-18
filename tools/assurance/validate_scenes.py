#!/usr/bin/env python3
"""Validate a demo's X3D scenes and write a receipt that names the real instrument. Exits non-zero on any failure.

Written after the external accountability review of 18 Nov 2026 (defect 5): the D3 bridge's tools/validate.py
exited 0 for an invalid file and for an empty glob, hard-coded the validator commit ("main fa5dccf") into its
receipt, and kept only the first 5 errors and 3 hints. Demo folders are never overwritten, so the fix lives here
as a shared tool that any demo version can call; old receipts stay as they were written.

  python3 tools/assurance/validate_scenes.py DEMO_DIR --x3d-mcp PATH [--glob 'scenes/*.x3d'] \
      [--expect N | --expect-list FILE] [--semantic] [--out receipt-xsd.json]

Exit codes (same convention as x3d.loom kit/loom):
  0  every expected scene is XSD-valid (and, with --semantic, has zero semantic errors)
  1  at least one scene is invalid or has a semantic error (the receipt is still written, in full, even when a
     file is malformed: that file records semantic_status not_run; tools/assurance/controls/malformed)
  2  instrument or input error: no files matched, the expected set does not match, x3d_mcp not importable,
     or the receipt already exists without --force

The receipt's validator identity is derived, not typed: the x3d_mcp checkout's HEAD commit and whether its
working tree is dirty, the sha256 of each XSD actually used, lxml and libxml2 versions, and Python.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def instrument(mcp: Path) -> dict:
    def git(*a):
        p = subprocess.run(["git", "-C", str(mcp), *a], capture_output=True, text=True)
        return p.stdout.strip() if p.returncode == 0 else None
    from lxml import etree
    import lxml
    from validation import validate as v  # imported from mcp/src
    return {
        "tool": "x3d_mcp validation.validate.validate_xml_with_hints" ,
        "x3d_mcp_commit": git("rev-parse", "HEAD"),
        "x3d_mcp_dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
        "x3d_mcp_remote": (git("config", "--get", "remote.origin.url") or "").split("/")[-1].removesuffix(".git") or None,
        "schemas": {ver: {"file": p.name, "sha256": sha256_bytes(p.read_bytes())} for ver, p in sorted(v.XSD_PATHS.items())},
        "lxml": lxml.__version__,
        "libxml2": ".".join(map(str, etree.LIBXML_VERSION)),
        "python": platform.python_version(),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("demo")
    ap.add_argument("--x3d-mcp", required=True, help="path to an x3d_mcp checkout (its src/ is imported)")
    ap.add_argument("--glob", default="scenes/*.x3d")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--expect", type=int, help="exact number of scenes that must match")
    g.add_argument("--expect-list", help="file with one expected relative path per line")
    ap.add_argument("--semantic", action="store_true", help="also run x3d_mcp semantic_diagnostics; any error fails")
    ap.add_argument("--out", default="receipt-xsd.json", help="receipt path, relative to DEMO unless absolute")
    ap.add_argument("--force", action="store_true", help="overwrite an existing receipt")
    a = ap.parse_args(argv)

    demo, mcp = Path(a.demo).resolve(), Path(a.x3d_mcp).resolve()
    sys.path.insert(0, str(mcp / "src"))
    try:
        from validation.validate import validate_xml_with_hints
        semantic = None
        if a.semantic:
            from validation.semantic import semantic_diagnostics as semantic
        ident = instrument(mcp)
    except Exception as e:  # the instrument could not start: error, never pass
        print(json.dumps({"error": "INSTRUMENT", "detail": f"{type(e).__name__}: {e}"}))
        return 2

    files = sorted(p for p in demo.glob(a.glob) if p.is_file())
    rel = [p.relative_to(demo).as_posix() for p in files]
    if not files:
        print(json.dumps({"error": "NO_FILES_MATCHED", "detail": a.glob}))
        return 2
    if a.expect is not None and len(files) != a.expect:
        print(json.dumps({"error": "EXPECTED_SET", "detail": f"{len(files)} files matched, {a.expect} expected"}))
        return 2
    if a.expect_list:
        want = [l.strip() for l in Path(a.expect_list).read_text().splitlines() if l.strip() and not l.startswith("#")]
        if sorted(want) != rel:
            print(json.dumps({"error": "EXPECTED_SET", "missing": sorted(set(want) - set(rel)), "extra": sorted(set(rel) - set(want))}))
            return 2

    results, bad = {}, 0
    for p, r in zip(files, rel):
        # one bad file must not take the receipt down with it (second review, 18 Nov 2026, defect 8: a malformed
        # file under --semantic raised before the receipt was written). Each stage records error or not_run.
        data = p.read_bytes()
        row = {"sha256": sha256_bytes(data), "bytes": len(data), "valid": False, "checked": False, "schema": None,
               "errors": [], "hints": [], "notes": []}
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as e:
            text = None
            row["errors"] = [f"not UTF-8: {e}"]
        if text is not None:
            try:
                res = validate_xml_with_hints(text)
                row.update(valid=bool(res.get("valid")), checked=res.get("checked", True), schema=res.get("schema_version"),
                           errors=res.get("errors", []), hints=res.get("hints", []), notes=res.get("notes", []))
            except Exception as e:
                row["xsd_instrument_error"] = f"{type(e).__name__}: {e}"
                row["errors"] = [row["xsd_instrument_error"]]
        if semantic is not None:
            row["semantic_errors"], row["semantic_warnings"] = [], []
            if text is None or not row["valid"] and any("parse error" in str(e).lower() or "syntaxerror" in str(e).lower() for e in row["errors"]):
                row["semantic_status"] = "not_run"
                row["semantic_reason"] = "the file does not parse, so meaning cannot be read"
            else:
                try:
                    d = semantic(text)
                    row["semantic_status"] = "ran"
                    row["semantic_errors"] = [x.__dict__ for x in d if x.level == "error"]
                    row["semantic_warnings"] = [x.__dict__ for x in d if x.level == "warning"]
                except Exception as e:
                    row["semantic_status"] = "error"
                    row["semantic_errors"] = [{"level": "error", "code": "SEMANTIC_INSTRUMENT_ERROR", "message": f"{type(e).__name__}: {e}"}]
        ok = row["valid"] and row["checked"] is not False and not row.get("semantic_errors") and row.get("semantic_status", "ran") == "ran"
        bad += not ok
        results[r] = row
        print(f"{'ok  ' if ok else 'FAIL'} {r} xsd={'valid' if row['valid'] else 'INVALID'} errors={len(row['errors'])}"
              + (f" semantic_errors={len(row['semantic_errors'])} warnings={len(row['semantic_warnings'])}" if semantic else ""))
        for e in row["errors"]:
            print("     ", e)

    receipt = {"schema": "x3d.demo.validate-scenes/1", "demo": demo.name if demo.name not in ("v1", "v2", "v3") else f"{demo.parent.name}/{demo.name}",
               "glob": a.glob, "files": len(files), "failed": bad, "status": "fail" if bad else "pass",
               "semantic": bool(semantic), "validator": ident, "results": results}
    out = Path(a.out) if Path(a.out).is_absolute() else demo / a.out
    if out.exists() and not a.force:
        print(json.dumps({"error": "RECEIPT_EXISTS", "detail": str(out)}))
        return 2
    out.write_text(json.dumps(receipt, indent=1, sort_keys=True) + "\n")
    commit = (ident["x3d_mcp_commit"] or "unknown")[:7] + ("+dirty" if ident["x3d_mcp_dirty"] else "")
    print(f"{len(files) - bad} of {len(files)} pass (x3d_mcp {commit}, lxml {ident['lxml']}, libxml2 {ident['libxml2']}) -> {out.name}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
