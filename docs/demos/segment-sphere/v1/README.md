# Demo 78 · Segment Sphere (segment-sphere/v1)

The [AWS Segment Wheel](https://github.com/hagopjay/aws_SegmentWheel) (301 services, 19 categories, September 2026)
as one X3D 4.0 scene with three shapes of the same data, morphed by one ecmascript `Script`:

| m | shape | what carries the meaning |
|---|---|---|
| 0 | **Wheel** | the source SVG's own geometry: rings at radius 204/444/684 of 1000, exact angles; lifecycle as depth (preview +0.6, closed -0.4, sunset -2.6) |
| 1 | **Segment sphere** | wedge angle -> longitude, so each category lune's area (2R^2·Δφ) is proportional to its service count; ring -> colatitude 40/90/140°; lifecycle -> radius (preview 1.14R, GA 1.02R, closed 0.88R, sunset fallen into a red core with a line from its old slot) |
| 2 | **Hopf 3-sphere** | each service's sphere point -> its Hopf fiber, a great circle in S³, stereographically projected; any two fibers link once (C(301,2) = 45,150 linked pairs); the 3 rings -> 3 nested tori; an isoclinic 4D rotation tumbles the fibration (it maps fibers to fibers) while gems flow along their circles |

Gems are pickable (TouchSensor -> Script nearest-gem -> `selected_changed` -> page card). The whole dataset is
also written into the file as a `MetadataSet` under `WorldInfo`, so the X3D stands on its own without the page.
Browsers without ecmascript show the static sphere state written in the file.

## Receipts (25 Nov 2026)

| check | result | instrument |
|---|---|---|
| extraction | 301 services, 19 categories, rings 59/99/143, GA 263 · preview 4 · closed 5 · sunset 29; all asserts pass | `build/extract.py` vs source `index.html` sha256 `28865e09…` |
| XSD + semantic | X3D 4.0 valid; 0 errors, 0 warnings, 34 info (DEFs addressed by the page/SAI) | x3d_mcp fork `4d433af` (`validation.validate` + `validation.semantic`), `assets/validate-receipt.json` |
| round trip | MetadataSet 301/301 services equal; watch list 38 equal; Script data fields equal | lxml, `build/validate.py` |
| load | ready in ~10.7 s; 0 console errors; 0 black frames of 8 | X_ITE 16.7.1, Chromium 158 (Playwright), SwiftShader WebGL2, `shots/shots-receipt.json` |
| Script cost | 4.3-5.8 ms per rebuild in the Hopf view (19,264 fiber + 4,800 torus + 1,806 gem points) | the Script's own `stats_changed`, SwiftShader container CPU |
| picking | asked service 144 (AWS DevOps Agent), Script returned 144, card shows it | `build/shots.mjs` |

Frame rates in the receipt are software rendering (SwiftShader), not a GPU; they are not a performance claim.

## Rebuild

```
python3 -I build/extract.py /path/to/aws_segmentwheel   # -> data/services.json
python3 -I build/build_x3d.py                           # -> assets/segment-sphere.x3d (embeds build/morph.js)
python3 build/validate.py /path/to/x3d_mcp              # -> assets/validate-receipt.json
NODE_PATH=... node build/shots.mjs http://127.0.0.1:8765/demos/segment-sphere/v1/ shots 2
```

## Learned here (folded into x3d.loom)

1. **X_ITE Script hot loops: keep the math in a closure.** Free names at Script top level resolve through the
   browser's field scope; moving the per-frame math into a `makeEngine()` closure took a rebuild from 69.6 ms to 4.8 ms.
2. **`MFVec3f.setValue(Float32Array)`** in X_ITE copies 14,448 points in ~0.2 ms vs ~7 ms building `SFVec3f`s; keep a portable fallback.
3. **Copy MF fields to plain arrays once** in `initialize()`; indexed reads through MF field proxies are slow per frame.
4. **Hopf fibers near the projection pole** blow up; re-space base latitudes away from it and use a soft horizon `RM·tanh(r/RM)` instead of a hard clamp (a hard clamp draws polygons).
5. **X_ITE's SANS font lacks ◇ and ◦** (it has †); spell those statuses out in 3D text.
6. **MetadataSet `name` is an NMTOKEN**: human labels with spaces go in a child `MetadataString name="label"`.

## Not tested

Real GPUs (all frames are SwiftShader; an Intel UHD 620 laptop blocklisted for WebGPU still gets WebGL2, which is all X_ITE needs, no WebGPU path);
Castle/Babylon/three.js; whether each AWS lifecycle status is still current.

See [DATA-ATTRIBUTION.md](DATA-ATTRIBUTION.md).
