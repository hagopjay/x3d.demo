# Gobbler Gyroscope v2: the Swarm (Demo 23, version 2)

v1 (`../v1/`) is unchanged. v2 is the same page, scene and graph, plus a swarm of **30,000 replicas of the Gobbler.flyte LangGraph agent graph** riding the ten flywheel hoops, with a live KPI panel. Default 30,000; the panel offers 3,000 / 10,000 / 30,000 / 100,000 / 262,144.

| Open | What it is |
|---|---|
| `index.html` | The v1 page with the swarm. On WebGPU the swarm draws on Babylon's own `GPUDevice` and binds the page's live kinetics buffer, so agents ride the hoops' real matrices. Without WebGPU it replaces the "needs WebGPU" wall with its own gyroscope on WebGL2. |
| `solo.html` | The swarm on its own (WebGPU if an adapter answers, else WebGL2). `?swarmgl=1` forces WebGL2, `?agents=100000`, `?warm=0` starts every replica at the start line. |
| `tests/parity.html` | JavaScript reference vs WGSL compute twin, bit for bit. |
| `tests/integration.html` | The integrated path against a stand-in Babylon body (shared device, shared hoop buffer). |

## What you are looking at

One spark = one replica of the compiled graph in x3d.gobbler `flyte/gobbler_flyte/gobbler.py`:

```
open -> scout -(signal)-> weaver -> witness -(refused, attempts left)-> weaver ... -> council -(ask)-> ask/wait -> keeper -> assayer -> close
              \-(no signal)----------------------------------------------------------------------------------> assayer
```

| Hoop sector (fraction of a turn) | Stage | Colour | What crowds there mean |
|---|---|---|---|
| 0.00-0.06 | open (waiting for the next cron tick) | dim gold | idle capacity |
| 0.06-0.20 | scout | cyan | sweeping sources |
| 0.20-0.40 | weaver | gold | Haiku weave (simulated) or the procedural fallback on attempt 3 |
| 0.40-0.54 | witness | violet | gate + validator verdict |
| 0.54 back to 0.20 | refused | red, flickering | backflow: a REFUSED verdict sends the replica back to weave |
| 0.54-0.62 | council | white | stand-up ruling |
| lifted off the hoop at 0.62 | ask human | pink | a question waits for HagopJay (answered, or times out to the preferred pick) |
| 0.62-0.80 | keeper | green | commit to the world; then a white comet falls into the core |
| 0.80-1.00 | assayer | amber | thesis checks |
| glides 0.20-0.80 | no signal | grey-blue | nothing worth weaving this cycle |
| dives toward the core | hold | crimson | **never recorded**; appears only when Chaos injects it |

The **ring spectrum** around each hoop is a 64-bin histogram of where that hoop's replicas are right now (bar height log-scaled, colour = the stage of that sector), rebuilt every frame with GPU atomics. The **core** brightens with the admitted-per-minute rate, and sends a shockwave ring.

## Where every probability comes from

`source/calibrate.py` reads the five recorded sim days in x3d.gobbler (`flyte/runs/sim-2026-11-18*/tape.jsonl`, mode `sim`, zero model calls) and writes `swarm/calibration.json` (with the sha256 of each tape). The five runs replay the same fixture day, so this is one day's distribution seen five times, not five independent days.

| Branch | Recorded count | Probability used | CPU twin, steady state (30,000 replicas, ticks 3,000-6,000) |
|---|---|---|---|
| Scout finds a signal | 175 / 240 cycles | 0.7292 | 0.7299 |
| Witness passes weave 1 | 90 / 175 | 0.5143 | 0.5134 |
| Witness passes weave 2 | 40 / 85 | 0.4706 | (weave 3 always passes, procedural) |
| Weaves done procedurally | 45 / 305 | 0.1475 | 0.1477 |
| Council asks a human | 40 / 175 | 0.2286 | 0.2291 |
| Human answered (vs timeout) | 12 / 32 | 0.375 | 0.3774 |
| Refusal codes | 45 / 45 / 40 of 130 (GATE_CONTAINMENT, MCP_SEMANTIC_PROFILE_COMPONENT, GATE_NODE_FORBIDDEN) | same | GPU run: 34.8 / 34.6 / 30.9 % |
| Council holds | 0 / 175 | 0 (Chaos slider injects up to 0.25) | |
| Simulated spend | $0.14149 over 260 Haiku weaves | $0.000544 per weave | |

CPU twin figures: Node 22.23.5 on the build container (Intel Xeon @ 2.10 GHz, 4 cores). The panel's "Recorded vs live" table repeats this check live and marks a row ✓ when the live rate is within 3 binomial standard errors of the recorded one.

The "Live fleet, $/day" tile is a projection: replicas x 48 cycles/day (the 30-minute cron) x the live dollars per cycle at the tapes' simulated Haiku prices. At 30,000 replicas it reads about $810/day. Nothing is called and nothing is billed.

## How it is built

- `swarm/model.js`: the state machine. Integer only: four u32 per replica (meta, tick, duration, PCG32 state), thresholds as p x 2^32. Durations in ticks of 1/30 s; one graph cycle averages 403 ticks (13.4 s) on screen against the real 30-minute cron (x134).
- `swarm/gpu.js`: WGSL. A compute pass steps every replica (`step`, workgroup 256) and rebuilds occupancy (10 x 11) and the angle histogram (10 x 64) with `atomicAdd`; render passes draw stars and hoops (solo only), the ring spectrum, agents as comets stretched along their velocity, admitted-entry sparks, and the core into an `rgba16float` target; a five-level dual-filter bloom (13-tap down, 9-tap tent up) and ACES tone map finish it. Over Babylon the final pass writes alpha 0, so the compositor adds the swarm's light onto the scene.
- `swarm/gl.js`: WebGL2. The CPU runs `model.js` (the same code the WGSL mirrors), uploads the state as an instanced `uvec4` attribute and the histogram as an `R32F` texture; the vertex shaders are line-for-line GLSL ES 3.00 ports. Same bloom chain (`RGBA16F` with `EXT_color_buffer_float`, else `RGBA8`).
- `swarm/swarm.js`: backend choice, fixed-step clock with interpolation, camera, hoop matrices (Babylon's kinetics buffer when integrated; a spin + precession + nutation stand-in when solo), KPI history.
- `swarm/hud.js`, `swarm/swarm.css`: the panel.
- `index.html` edits against v1 (everything else byte-identical): build id, title, kicker, nav chips, a `Swarm panel` button, `GobblerKinetics.__G` getter (exposes the kinetics state so the swarm can bind `kinLoops`), a class on the "needs WebGPU" wall so solo mode can hide it, and the swarm scripts before `</body>`.

## Tested, and on what

| Check | Result | Rig |
|---|---|---|
| JS vs WGSL parity, 4,096 agents x 600 ticks | bit-identical (fnv 1f28f7cc both), 128 event counters equal | Chrome for Testing 158.0.8127.36, headless, SwiftShader WebGPU |
| 30,000 x 400 ticks | bit-identical (fcc6c602) | same |
| 131,072 x 200 ticks | bit-identical (4ddc04a0) | same |
| 30,000 x 300 ticks, Chaos 0.6 | bit-identical (ed9b03eb) | same |
| GPU steady state after 1,800 ticks + 896 more | first pass 0.5144, signal 0.7325, procedural 0.1475 | same |
| Integrated path vs stand-in Babylon body | shared device and shared hoop buffer bound, 297 frames, 12,727 lit pixels | same |
| v2 page with `navigator.gpu` removed | WebGL2 solo gyroscope replaces the wall, panel live | same, WebGL2 on ANGLE/SwiftShader |
| CPU twin cost per tick | 3,000: 0.12 ms; 30,000: 0.44 ms; 100,000: 1.18 ms; 262,144: 3.23 ms | Node 22.23.5, Xeon @ 2.10 GHz |

**Not tested here:** SwiftShader is a CPU rasteriser, not a GPU; no frame rate in this folder is a GPU frame rate, and none is quoted. Headless Chromium on SwiftShader cannot present a WebGPU swap chain (the device is lost on the first present; v1 does the same in this rig), so the WebGPU screenshots in `shots/` were taken through `?capture=1`, which renders offscreen and copies pixels to a 2D canvas. The integrated view over the real Babylon scene has not been seen on a GPU yet: it needs a browser with a working WebGPU adapter (on the owner's Windows machine, Chrome with `chrome://flags/#enable-unsafe-webgpu`).

## Files

`shots/`: s1 solo WebGPU with the panel; s2 one hoop isolated with stage labels and one replica followed; s3 Chaos 0.8 (injected holds and refusal surge); s4 the v2 page falling back to WebGL2; s5 100,000 replicas.

All five shots: Chrome for Testing 158.0.8127.36 headless, SwiftShader (s1-s3, s5 WebGPU through `?capture=1`; s4 WebGL2 on ANGLE/SwiftShader), 1600 x 900. The fps badge in each shot is the software rasteriser's, not a GPU figure. In s3 the red Δ on first pass is the point: Chaos 0.8 cuts the pass rate on purpose. In s5 two rows show amber after 16 s: at 100,000 replicas in capture mode only three readbacks had landed, so the window is short and still carries warm-up lag; the steady-state check in the table above is the one to trust.
