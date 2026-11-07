# Demo sources

Pages are built with the public x3d.loom repository (hagopjay/x3d.loom): v1 from PR #12; v2 adds the adapter fallback (templates `viewer-v2-1.tpl.html`, `viewer-v3-1.tpl.html`, selected with `TPL=...`).

First built with PR #12:
- Collider events: `python3 -I x3d.webgpu/demo/src/build-events.py OUTDIR` (scenes regenerated from `kit/examples/hep/fixtures`, look v3).
- Heritage facade: `x3d.webgpu/demo/src/build-v3.py` on `facade.x3d` (synthetic, generated, CC0; three Viewpoints added).

Checked headless on a software GPU for correctness only; no timings.

| file | sha256 | bytes |
|---|---|---|
| collider-events/v1/dijet.html | aceb1cf3858f22aad22b0e128731c7664790bfece4d846c88a79c5b72ad33378 | 2373128 |
| collider-events/v1/exact-z.html | 55a8145d697020825f8f0448be0f212a0125a8fa5c95d7d4e77bd5f7cce76645 | 752968 |
| collider-events/v1/qcd-in-flight.html | b7212c0a11794b4e349d177aa3cf8f96b85360b0b66ce26c6da0a8122e4a7fcb | 2560264 |
| collider-events/v1/qcd.html | 6b26c45f62a787b0f95b9165507a658243f468546b6542d2c04b77462af4e578 | 2837175 |
| collider-events/v1/z-to-muons.html | 77b34e12ae85c3c4f859ced158a65299a954046cc380239716bb7ad40fbcba72 | 2828180 |
| collider-events/v2/dijet.html | d9809e53ef2cd50d042147f929662a02bb14e27d63a072569e4da9ed3abd0f76 | 2373959 |
| collider-events/v2/exact-z.html | 4a21ac0f8b8d8313cc2159be422e95a29e6046b4ed78a0d7b751328ed08e5610 | 753799 |
| collider-events/v2/qcd-in-flight.html | fa5d92494983f3148cf561f94d7284b80aa0a389ac86028729802e230f139d73 | 2561095 |
| collider-events/v2/qcd.html | 6a74d4f518eae67935cf62914c0460056239cb6dbb3a0fe799cb9c2cce8e3c68 | 2838006 |
| collider-events/v2/z-to-muons.html | 3f6c2985d94b347a3797decd8185536278d5f3045bd345494d6f0fc7dd85d1af | 2829011 |
| heritage-facade/v1/facade.html | 94871a3ba1a7dbf22ecb5151acf46f409fb88b661c5c5b18cfa1b5757e2f264f | 12447348 |
| heritage-facade/v1/facade.x3d | 9d7cac704d9575bb21676ab9f52d19ab1e70d0cc665b09de5bd4d63bddbfea2f | 12257463 |
| heritage-facade/v2/facade.html | 8c9476c94a98fa1052e4858a60d27fccbae82db9959725e768b07ad8ca9c8439 | 12448179 |
| heritage-facade/v2/facade.x3d | 9d7cac704d9575bb21676ab9f52d19ab1e70d0cc665b09de5bd4d63bddbfea2f | 12257463 |
