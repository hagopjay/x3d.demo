#!/usr/bin/env python3
"""Assemble giza_bakes_g4.ipynb: one self-contained Colab notebook for the GPU-heavy Blenderizer bakes.

Every job's build sources (and their tile images) are embedded gzip+base64, so the notebook needs only the internet for
Blender itself and the pinned x3d-blender-io commit. Results (X3D, textures, linear caches, receipts) go to
My Drive/x3d.io/blenderizer-bakes/<job>-<profile>/ in hagopjay's Drive; grading, shots and validation run back on the Mac.

usage: python3 -I build_g4_notebook.py [OUT.ipynb]     (run from a checkout that has all four demo folders)
Add a job: append to JOBS (name -> source dir, entry script, extra args, files).
"""
import base64
import gzip
import hashlib
import json
import os
import sys
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
# this file lives in docs/demos/blender-giza-crawl/v2/build/g4/; every job's sources are in its own demo folder's build/
DEMOS = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BLENDER_VERSION = "5.1.2"
ADDON = ("https://github.com/hagopjay/x3d-blender-io", "47ed742")
JOBS = {
    "crawl": dict(src=os.path.join(DEMOS, "blender-giza-crawl", "v2", "build"), entry="build_crawl_v2.py", args=[],
                  files=["build_crawl_v2.py", "bakery.py", "mats.py", "geo.py", "hall.py", "pyramid.py", "osiris.py", "outdoor.py",
                         "rig.py", "tiles/glyphs.png", "tiles/stars.png", "tiles/frieze.png", "tiles/flame.png"],
                  note="Giza Crawl v2: Hall of Records, pyramid interior, Osiris Shaft, plateau (about 50 baked surfaces)"),
    "masonic": dict(src=os.path.join(DEMOS, "masonic-lodge", "v3", "build"), entry="build_lodge.py", args=[],
                    files=["build_lodge.py", "bakery.py", "mats.py", "geo.py", "tiles/radiance.png"],
                    note="Masonic Lodge v3: Khufu in section with lit voids, Khafre, Menkaure, the symbolic capstone"),
    "fall": dict(src=os.path.join(DEMOS, "blender-giza-fall", "v2", "build"), entry="build_fall_v2.py", args=[],
                 files=["build_fall_v2.py", "blenderize_fall.py", "bakery.py", "mats.py", "geo.py", "rig.py"],
                 note="Giza Fall v2: v1's Bullet ragdoll on a rebuilt, baked north face at golden hour"),
    "twins": dict(src=os.path.join(DEMOS, "semantic-twins", "v3", "build"), entry="build_context.py", args=["--record=@SRC@/twins/scene.xml"],
                  files=["build_context.py", "bakery.py", "mats.py", "geo.py", "scene.xml"],
                  note="Semantic Twins v3 (and Fault Lab v3): baked context layer for the heritage record scene"),
}
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "giza_bakes_g4.ipynb")
cells = []


def md(s):
    cells.append(dict(cell_type="markdown", metadata={}, source=textwrap.dedent(s).strip("\n")))


def code(s, form=False):
    cells.append(dict(cell_type="code", metadata={"cellView": "form"} if form else {}, execution_count=None, outputs=[],
                      source=textwrap.dedent(s).strip("\n")))


payload, manifest = {}, {}
for job, j in JOBS.items():
    for f in j["files"]:
        raw = open(os.path.join(j["src"], f), "rb").read()
        payload["%s/%s" % (job, f)] = base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode()
        manifest["%s/%s" % (job, f)] = hashlib.sha256(raw).hexdigest()[:12]
build_id = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:8]

md(f'''
# Blenderizer bakes on the G4  (build {build_id})

**What this does.** Runs the GPU-heavy Blender bakes for the x3d.demo visual upgrades: Blender builds each scene from
procedural materials and lights, Cycles bakes the light into image textures on the GPU (OptiX), and x3d-blender-io exports
X3D 4.0. The Mac then grades the textures, shoots before/after frames and validates. Jobs in this build:
{chr(10).join("- `%s`: %s" % (k, v["note"]) for k, v in JOBS.items())}

**How to run it.**
1. Runtime ▸ Change runtime type ▸ **G4 GPU**. Sign in as **hagopjay** (the account with the G4 and `My Drive/x3d.io`).
2. Shift+Enter on each cell, top to bottom. Cell 5 picks the job and profile: start with `PROFILE = "quick"` (a few minutes,
   proves the machine), then `"g4"` (final quality).
3. If a cell prints ❌ or a traceback, stop and tell Claude what it said.

**Output.** `My Drive/x3d.io/blenderizer-bakes/<job>-<profile>/`: the X3D, `tex/*.jpg`, `cache/*.npy` (linear light, for
re-grading on the Mac without re-baking), `route.json`, `bake.json`, the build log. Nothing is published.

**Download.** Cell 3 fetches the Linux build of Blender {BLENDER_VERSION} from download.blender.org (several hundred MB,
size not measured here; the same build ran on this G4 for the JEPA run) and clones x3d-blender-io at `{ADDON[1]}`.

**Cost.** Compute units are used while the GPU runtime is connected. When done: Runtime ▸ Disconnect and delete runtime.
''')
code('''
#@title 1. What machine did we get? { display-mode: "form" }
import os, subprocess, multiprocessing
print(subprocess.run("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader", shell=True, capture_output=True, text=True).stdout or "❌ no NVIDIA GPU: pick the G4 runtime")
print("CPUs:", multiprocessing.cpu_count())
''', form=True)
code('''
#@title 2. Mount Drive { display-mode: "form" }
from google.colab import drive
drive.mount("/content/drive")
DRIVE = "/content/drive/MyDrive/x3d.io/blenderizer-bakes"
os.makedirs(DRIVE, exist_ok=True)
print("✅ results go to", DRIVE)
''', form=True)
code(f'''
#@title 3. Blender {BLENDER_VERSION} and x3d-blender-io {{ display-mode: "form" }}
import pathlib, shlex
def sh(cmd, check=True):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), text=True)
    if check and r.returncode:
        raise SystemExit("❌ failed: %s" % cmd)
ROOT = pathlib.Path("/content/bk")
BL = ROOT / "blender" / "blender"
if not BL.exists():
    sh("apt-get -qq update && apt-get -qq install -y libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libegl1 libxkbcommon0 libsm6 xz-utils", check=False)
    (ROOT / "blender").mkdir(parents=True, exist_ok=True)
    sh("curl -sSL https://download.blender.org/release/Blender5.1/blender-{BLENDER_VERSION}-linux-x64.tar.xz | tar -xJ -C %s --strip-components=1" % (ROOT / "blender"))
sh([str(BL), "--version"])
ADDON = ROOT / "x3d-blender-io"
if not ADDON.exists():
    sh(["git", "clone", "-q", "{ADDON[0]}", str(ADDON)])
sh(["git", "-C", str(ADDON), "checkout", "-q", "{ADDON[1]}"])
print("✅ Blender and the add-on are ready")
''', form=True)
code('''
#@title 4. Write the build sources (embedded; hashes below) { display-mode: "form" }
import base64, gzip, hashlib, json
_FILES = %s
_HASH = %s
SRC = ROOT / "src"
for k, b in _FILES.items():
    p = SRC / k
    p.parent.mkdir(parents=True, exist_ok=True)
    raw = gzip.decompress(base64.b64decode(b))
    assert hashlib.sha256(raw).hexdigest()[:12] == _HASH[k], k
    p.write_bytes(raw)
print("✅", len(_FILES), "files, build %s")
''' % (json.dumps(payload), json.dumps(manifest), build_id), form=True)
code('''
#@title 5. Choose the job and the profile { display-mode: "form" }
JOB = "crawl"  #@param ["%s"]
PROFILE = "quick"  #@param ["quick", "g4"]
DEVICE = "OPTIX"  #@param ["OPTIX", "CUDA", "CPU"]
''' % '", "'.join(JOBS), form=True)
code('''
#@title 6. Bake and export (streams the log; about 1 to 3 min for quick, longer for g4) { display-mode: "form" }
import time, shutil
ENTRY = %s
out = ROOT / "out" / ("%%s-%%s" %% (JOB, PROFILE))
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)
env = dict(os.environ, BAKE_DEVICE=DEVICE, PYTHONUNBUFFERED="1")
cmd = [str(BL), "-b", "--python", str(SRC / JOB / ENTRY[JOB][0]), "--", str(out), str(ADDON / "source"), "--profile=" + PROFILE] + [a.replace("@SRC@", str(SRC)) for a in ENTRY[JOB][1]]
t0 = time.time()
with open(out / "build.log", "w") as log:
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    for line in p.stdout:
        log.write(line)
        if line.startswith(("BAKED", "BAKE DEVICE", "DONE", "Traceback", "Error")) or "Error:" in line:
            print(line.rstrip()[:200])
    p.wait()
print(("✅" if p.returncode == 0 else "❌"), "exit", p.returncode, "after %%.0f s" %% (time.time() - t0))
''' % json.dumps({k: [v["entry"], v["args"]] for k, v in JOBS.items()}), form=True)
code('''
#@title 7. Copy the results to Drive { display-mode: "form" }
dst = pathlib.Path(DRIVE) / out.name
if dst.exists():
    shutil.rmtree(dst)
shutil.copytree(out, dst, ignore=shutil.ignore_patterns("_addon", "*.blend1"))
n = sum(1 for _ in dst.rglob("*") if _.is_file())
print("✅", n, "files in", dst, "(%.0f MB)" % (sum(f.stat().st_size for f in dst.rglob("*") if f.is_file()) / 1e6))
print("Tell Claude: 'G4 bake %s done'." % out.name)
''', form=True)

nb = dict(nbformat=4, nbformat_minor=5, metadata={"accelerator": "GPU", "colab": {"gpuType": "G4", "provenance": []},
                                                   "kernelspec": {"name": "python3", "display_name": "Python 3"}}, cells=cells)
json.dump(nb, open(OUT, "w"), indent=1)
print("wrote", OUT, "build", build_id, "files", len(payload), "bytes", os.path.getsize(OUT))
