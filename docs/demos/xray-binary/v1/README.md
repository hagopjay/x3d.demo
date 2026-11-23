# Demo 74 · Binary X-Ray: the debugger lies (v1)

A small name-to-serial crackme reverse-engineered by the **x3d.xray binary lens** (`x3dray.binary`, Pass A + B),
drawn as a Blender-baked X3D 4.0 world. Live page: `index.html`.

| part | what it shows | drawn from |
|---|---|---|
| binary city | one building per function (height = instructions, tiers = basic blocks), hot roofs on anti-analysis, gold spire on the gatekeeper | `data/binary.json`, `data/callgraph.json` |
| PLT gates | each import stub as a doorway; ptrace's lintel glows | `binary.json` imports |
| call constellation | 12 arcs (direct / PLT / runtime `__libc_start_main(main)`), a packet travelling each | `callgraph.json` edges |
| int3 scan ring | the 48 bytes of `derive` that `main` scans for 0xCC; under gdb one turns red | ledger H4/H6, model `scan_bytes` |
| the two worlds | Switch `Worlds`: native (salt 0) vs under gdb (salt 0xa5a5a5a5, poisoned serial accepted) | ledger H2, H3, H5 |
| investigation helix | one rung per hypothesis, colour = re-run verdict, lines to the functions each is about | `data/ledger.json` |
| capability lattice | FCA concepts over functions x imported capabilities | `data/capability.json` |
| .rodata wall | encrypted bytes beside the strings the H1 decoder recovers | ledger H1 |

## Results (grades: Confirmed = re-run here)

| claim | result | instrument |
|---|---|---|
| H1 strings are rolling-XOR (0x33 + 7i) | Confirmed: 3 strings decoded statically, 0 visible to `strings` | GNU objdump 2.42, strings |
| H2 ptrace ctor poisons the salt | Confirmed: `PTRACE_TRACEME) = -1 EPERM`; g_salt = 0xa5a5a5a5 at main | strace 6.8, gdb 15.1 |
| H3 the debugger lies | Confirmed: F104-7CB6 accepted under gdb, rejected natively | gdb 15.1 + argv run |
| H4 defeat both poisons | Confirmed: shim + breakpoint outside derive gives g_salt = 0x00000000 | gdb 15.1, LD_PRELOAD shim |
| H5 keygen | Confirmed: 2000/2000 accepted, 200/200 mutants rejected; alice → 5470-E4D2 | native oracle, seed 20261123 |
| H6 (new) breakpoint on derive trips the scan | Confirmed: g_salt = 0x5a5a0000 with the shim | gdb 15.1 |
| RE witnesses | 13/13 re-run and match | gate re_witness |
| RE gates | 4/4 pass (fact, witness, verdict, scene) | x3dray/binary/gates_bin.py |
| gatekeeper | `main`; passage `_start → derive` = [main] | x3dray.centrality |
| X3D | both files XSD 4.0 valid; semantic: 38 + 5 info, 0 warnings, 0 errors | x3d_mcp fork 4d433af (`assets/validate-receipt.json`) |
| frames | 8/8 non-black, mean luminance 0.072-0.161 | X_ITE 16.7.1, Chromium 157 (Playwright), SwiftShader (`shots/shots-receipt.json`) |

Imported ledger agreement: H1-H5 agree with the outside agent's verdicts (it worked on a stripped build in radare2; this run used the symbolized build). H6 is new.

## Bake receipt (`assets/bake-receipt.json`)

Blender 5.3.0 (`bpy` wheel), Cycles CPU, 384 samples, seed 74, indirect clamp 4.0, denoise off, VERTEX_COLORS DIFFUSE (direct + indirect, colour pass off).
Sun 4.0 at azimuth 220°, elevation 42°, colour (1.0, 0.9, 0.78), disc 6°; world (0.18, 0.26, 0.45) × 0.55. Emissive parts (hot roofs, gold crown, window ledges) emit in the bake so they light their neighbours.
Finish: exposure so the 70th-percentile ground corner is 0.55, light floor (0.05, 0.07, 0.12), × albedo, sRGB, soft shoulder from 0.8, emissive share 0.75.
Ground top gridded (88 cuts) so building shadows land on it. Meshes: Ground 17,251 faces / 72,736 corners; City 2,401 / 9,664. Bake 8.4 s.
Export: x3d-blender-io 2.7.4 (main 0eb4809), X3D 4.0; PhysicalMaterial, Background, NavigationInfo stripped (unlit corners); ColorRGBA with alpha 1 welded to Color. `city-baked.x3d` 2.76 MB, sha256 `ec3a3cfd…a71f78`.

## Rebuild

```sh
# 1. the lens (in x3d.xray): build the target, run the chain into this folder's data/
cd x3d.xray/targets && python3 gen_strings.py && gcc -O2 -g -o ../crackme1 crackme1.c && cd ..
python3 -m x3dray.binary all ./crackme1 --out OUT --to derive --ledger specs/crackme1.hypotheses.json \
    --claims specs/crackme1.bin.json --shim targets/ptrace_shim.c      # copy OUT/*.json to data/
# 2. layout, bake, assemble, validate, frames (here)
python3 build/layout.py
BPY_PYTHON build/bake_city.py --addon x3d-blender-io/source --samples 384   # Python with bpy 5.3.0
python3 build/assemble.py
python build/validate.py x3d_mcp                                          # needs lxml, xmlschema, jsonschema, x3d
NODE_PATH=$(npm root -g) node build/shots.mjs http://127.0.0.1:8765/demos/xray-binary/v1/ shots 2   # then PNG -> WebP
```

## What was and was not tested

Tested: all six hypotheses on one Linux x86-64 machine (Ubuntu 24.04 container, gcc 13.3.0); every RE witness re-run; XSD + semantic validation; loading and frames in X_ITE 16.7.1 under SwiftShader.
Not tested: the stripped build (trace probes read the `g_salt` symbol); Windows, macOS, ARM; real GPUs; other X3D browsers (Castle, Babylon, three.js); other binaries (the ledger spec and keygen model are specific to crackme1).

Method credit: ioma8, ["LLM assisted reverse engineering"](https://www.slowchronicle.com/posts/llm-assisted-reverse-engineering), Slow Chronicle, 18 Nov 2026. See `DATA-ATTRIBUTION.md`.
