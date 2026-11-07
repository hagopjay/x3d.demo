# Demo sources

Pages are built with the public x3d.loom repository (hagopjay/x3d.loom), PR #12:
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
| heritage-facade/v1/facade.html | 94871a3ba1a7dbf22ecb5151acf46f409fb88b661c5c5b18cfa1b5757e2f264f | 12447348 |
| heritage-facade/v1/facade.x3d | 9d7cac704d9575bb21676ab9f52d19ab1e70d0cc665b09de5bd4d63bddbfea2f | 12257463 |
