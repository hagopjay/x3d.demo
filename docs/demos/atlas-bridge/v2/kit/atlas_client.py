#!/usr/bin/env python3
"""atlas_client: a small guarded client for the World Labs Atlas Developer API (api/v2).

Guards, in the order they act:
  1. Ledger first. Every paid task is written to the ledger with its price BEFORE the request leaves; a task
     whose price would take the ledger past the cap is refused locally. Prices come from the account's rate
     card (see PRICES), never from a guess.
  2. Idempotency. The key is stored in the ledger entry, so a retry of an uncertain submission reuses it
     (errors.md: "Retry the same logical submission with its original idempotency key").
  3. No resubmits while running: wait() only reads.
  4. Secrets. The key is read from WLT_API_KEY and sent as a header; it is never logged. Signed read URLs are
     credentials too ("treat both as secrets", assets.md), so every stored operation has them removed.
Downloads use the project read prefix (POST /assets:createReadPrefix), not the per-output signed url.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = "https://api.atlas.worldlabs.ai/api/v2"
# Atlas API pricing, account Developer Platform page, read 23 Nov 2026 (credits; 1,000 credits = 1 USD)
PRICES = {"images2PosedRGBD_per_image": 2, "frame_first": {"rgb": 40, "rgbd": 50}, "frame_additional": {"rgb": 8, "rgbd": 10},
          "image_generation": {"rgb": 40, "rgbd": 50}, "splats_refined": 5000, "splats_draft": 500, "mesh_export": 500}
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".exr": "image/x-exr", ".webp": "image/webp",
        ".spz": "application/octet-stream", ".glb": "model/gltf-binary"}
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/x-exr": ".exr", "image/webp": ".webp", "model/gltf-binary": ".glb"}


def frames_price(n: int, depth: bool) -> int:
    k = "rgbd" if depth else "rgb"
    return PRICES["frame_first"][k] + (n - 1) * PRICES["frame_additional"][k]


def price(task: str, body: dict) -> int:
    if task == "images2PosedRGBD":
        return PRICES["images2PosedRGBD_per_image"] * len(body["frames"])
    if task == "atlasChisel":
        return frames_price(len(body["targetFrames"]), bool(body.get("returnDepth")))
    if task == "atlasGenerate":
        return frames_price(len(body["targetCameras"]), bool(body.get("returnDepth")))
    if task == "atlasTextToImage":
        return PRICES["image_generation"]["rgbd" if body.get("returnDepth") else "rgb"] * int(body.get("numSamples") or 1)
    if task == "posedImages2Splats":
        return PRICES["splats_refined"] if body.get("refine", True) else PRICES["splats_draft"]
    if task == "splats2Mesh":
        return PRICES["mesh_export"]
    raise ValueError(f"no price known for task {task!r}")


def scrub(o):
    """Drop signed URLs from anything that is going to be stored."""
    if isinstance(o, dict):
        return {k: ("[signed URL removed]" if k in ("url", "readUrl", "uploadUrl", "signedQuery") and isinstance(v, str) else scrub(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(v) for v in o]
    return o


class BudgetExceeded(RuntimeError):
    pass


class AtlasClient:
    def __init__(self, ledger: str | Path, cap: int, already_spent: int = 0):
        self.ledger_path = Path(ledger)
        self.cap = int(cap)
        if self.ledger_path.exists():
            self.ledger = json.loads(self.ledger_path.read_text())
        else:
            self.ledger = {"cap": self.cap, "opening_spent": already_spent, "price_source": "account Developer Platform rate card, 23 Nov 2026",
                           "entries": [], "assets": {}}
            self._save()
        self.ledger["cap"] = self.cap
        self._prefix = None

    # ------------------------------------------------------------------ ledger
    RANK = {"pending": 0, "submitted": 1, "succeeded": 2, "failed": 2, "refused": 2}

    def _merge(self):
        """Fold in what other runs wrote since this one loaded the ledger (the file and its journal copy), so two
        runs that overlap can neither lose an entry nor step past the cap unseen. Entries match by idempotency key;
        the further-along state wins."""
        mine = {e["idempotency_key"]: e for e in self.ledger["entries"]}
        for src in (self.ledger_path, self.ledger_path.with_suffix(".journal.json")):
            if not src.exists():
                continue
            try:
                other = json.loads(src.read_text())
            except Exception:
                continue
            for e in other.get("entries", []):
                m = mine.get(e["idempotency_key"])
                if m is None:
                    self.ledger["entries"].append(e); mine[e["idempotency_key"]] = e
                elif self.RANK[e["state"]] > self.RANK[m["state"]]:
                    m.clear(); m.update(e)
            for k, v in other.get("assets", {}).items():
                self.ledger["assets"].setdefault(k, v)

    def _save(self):
        self._merge()
        for dest in (self.ledger_path, self.ledger_path.with_suffix(".journal.json")):
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            tmp.write_text(json.dumps(self.ledger, indent=1))
            tmp.replace(dest)

    def committed(self) -> int:
        """Credits the ledger counts: everything not known to have failed or been refused."""
        return self.ledger.get("opening_spent", 0) + sum(e["price"] for e in self.ledger["entries"] if e["state"] in ("pending", "submitted", "succeeded"))

    def summary(self) -> str:
        e = self.ledger["entries"]
        return f"ledger: {self.committed()} of {self.cap} credits committed; {sum(1 for x in e if x['state'] == 'succeeded')} succeeded, {sum(1 for x in e if x['state'] in ('pending', 'submitted'))} open, {sum(1 for x in e if x['state'] in ('failed', 'refused'))} failed or refused"

    # ------------------------------------------------------------------ http
    def _req(self, method: str, path: str, body=None, headers=None, timeout=120):
        key = os.environ.get("WLT_API_KEY")
        if not key:
            raise RuntimeError("WLT_API_KEY is not set")
        h = {"WLT-Api-Key": key, "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None), dict(r.headers)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                js = json.loads(raw)
            except Exception:
                js = {"raw": raw[:500].decode("utf-8", "replace")}
            return e.code, js, dict(e.headers)

    # ------------------------------------------------------------------ assets
    def upload(self, path: str | Path, name: str | None = None) -> str:
        """Create a READY asset from a local file under 10 MiB (inline base64). Cached by sha256."""
        p = Path(path)
        raw = p.read_bytes()
        if len(raw) >= 10 * 1024 * 1024:
            raise ValueError(f"{p.name}: {len(raw)} bytes, inline upload needs under 10 MiB")
        sha = hashlib.sha256(raw).hexdigest()
        if sha in self.ledger["assets"]:
            return self.ledger["assets"][sha]["id"]
        mime = MIME.get(p.suffix.lower())
        if not mime:
            raise ValueError(f"no MIME type for {p.suffix}")
        code, js, _ = self._req("POST", "/assets", {"asset": {"displayName": name or p.name, "base64": f"data:{mime};base64," + base64.b64encode(raw).decode()}})
        aid = (js or {}).get("id")
        if code not in (200, 201) or not aid or js.get("state") != "READY":
            raise RuntimeError(f"upload {p.name}: HTTP {code} {json.dumps(scrub(js))[:400]}")
        self.ledger["assets"][sha] = {"id": aid, "file": p.name, "bytes": len(raw), "mime": js.get("mimeType"), "state": js.get("state")}
        self._save()
        return aid

    # ------------------------------------------------------------------ tasks
    def submit(self, task: str, body: dict, label: str, *, expect_price: int | None = None) -> dict:
        """Submit one paid task. Returns the ledger entry (with the operation id). Refuses over the cap."""
        for e in self.ledger["entries"]:
            if e["label"] == label and e["state"] in ("pending", "submitted", "succeeded"):
                return e                                             # same logical call: never pay twice
        self._merge()
        for e in self.ledger["entries"]:
            if e["label"] == label and e["state"] in ("pending", "submitted", "succeeded"):
                return e
        p = price(task, body)
        if expect_price is not None and p != expect_price:
            raise RuntimeError(f"{label}: priced {p}, expected {expect_price}; not sent")
        if self.committed() + p > self.cap:
            raise BudgetExceeded(f"{label}: {p} credits would take the ledger to {self.committed() + p}, over the cap {self.cap}; not sent")
        entry = {"label": label, "task": task, "price": p, "state": "pending", "idempotency_key": str(uuid.uuid4()),
                 "request_sha256": hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest(), "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        self.ledger["entries"].append(entry)
        self._save()
        code, js, hdr = self._req("POST", f"/tasks:{task}", body, {"Idempotency-Key": entry["idempotency_key"]})
        if code not in (200, 201, 202) or not js or not js.get("id"):
            entry.update(state="refused", http=code, error=scrub(js), retry_after=hdr.get("Retry-After"))
            self._save()
            raise RuntimeError(f"{label}: HTTP {code} {json.dumps(scrub(js))[:900]}")
        entry.update(state="submitted", operation=js["id"])
        self._save()
        return entry

    def wait(self, entry: dict, *, timeout_s: int = 1800, poll_s: int = 20) -> dict:
        """Block until the operation is done (reads only). Marks the ledger entry succeeded or failed."""
        op_id, t0 = entry["operation"], time.time()
        op = None
        while time.time() - t0 < timeout_s:
            code, op, _ = self._req("POST", f"/operations/{op_id}:wait", {"timeoutSecs": min(60, poll_s * 3)}, timeout=150)
            if code != 200:
                code, op, _ = self._req("GET", f"/operations/{op_id}")
            if code == 200 and op and op.get("done"):
                break
            time.sleep(poll_s if code == 200 else poll_s * 2)
        if not (op and op.get("done")):
            return {"done": False, "id": op_id}
        entry["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        entry["seconds"] = round(time.time() - t0, 1)
        if op.get("error"):
            entry.update(state="failed", error=scrub(op["error"]))      # failed runs are free (posed-images-to-splats.md)
        else:
            entry["state"] = "succeeded"
        self._save()
        return op

    def get(self, op_id: str) -> dict:
        code, op, _ = self._req("GET", f"/operations/{op_id}")
        if code != 200:
            raise RuntimeError(f"get operation: HTTP {code}")
        return op

    # ------------------------------------------------------------------ downloads
    def _read_prefix(self):
        if self._prefix and self._prefix["t"] > time.time() - 45 * 60:
            return self._prefix
        code, js, _ = self._req("POST", "/assets:createReadPrefix")
        if code != 200:
            raise RuntimeError(f"createReadPrefix: HTTP {code}")
        self._prefix = {"base": js["baseUrl"], "q": js["signedQuery"], "t": time.time()}
        return self._prefix

    def download(self, asset_id: str, out_dir: str | Path, stem: str | None = None) -> Path:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        code, a, _ = self._req("GET", f"/assets/{asset_id}")
        if code != 200:
            raise RuntimeError(f"get asset {asset_id}: HTTP {code}")
        mime = a.get("mimeType") or ""
        ext = EXT.get(mime, "")
        dest = out_dir / f"{stem or asset_id}{ext}"
        if dest.exists() and dest.stat().st_size == int(a.get("sizeBytes") or -1):
            return dest
        if a.get("contentPath"):
            pf = self._read_prefix()
            url = pf["base"] + a["contentPath"] + "?" + pf["q"]
        else:                                                         # transient asset: per-asset read URL
            code, r, _ = self._req("POST", f"/assets/{asset_id}:createReadUrl")
            if code != 200:
                raise RuntimeError(f"createReadUrl {asset_id}: HTTP {code}")
            url = r["readUrl"]
        with urllib.request.urlopen(urllib.request.Request(url), timeout=600) as r:
            data = r.read()
        if not ext:                                                   # name the file from its magic bytes
            ext = ".spz" if data[:2] == b"\x1f\x8b" else ".glb" if data[:4] == b"glTF" else ".bin"
            dest = out_dir / f"{stem or asset_id}{ext}"
        dest.write_bytes(data)
        return dest

    def save_operation(self, op: dict, out_dir: str | Path) -> Path:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        p = out_dir / "operation.json"
        p.write_text(json.dumps(scrub(op), indent=1))
        return p
