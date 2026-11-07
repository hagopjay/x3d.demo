# Neural Canvas on Babylon WebGPU, v2

Built 2026-11-07 from x3d.loom `x3d.brain/page` and `x3d.webgpu/demo/src` at commit ed2625f (x3d.loom PR #18):

    python3 -I x3d.webgpu/demo/src/build-brain.py --page x3d.brain/page --out docs/demos/brain-torso/v2/index.html --single

`index.html` sha256 7649cd3806ef2d4d71afbba12bb18ab6c51724cf258a80a7816b6cc57646785e, 2,973,565 bytes, bundle id `49ff93344448` (shown in the Timing result). Babylon.js 9.32.0 loads from jsdelivr with a subresource-integrity hash. v1 (`../v1/`) is unchanged.

What changed from v1: the pixels did not. A full-page capture with `?timing=0` is identical to a rebuild of v1 (0 of 682,000 pixels differ). v2 adds an adapter retry (default, options, low-power, fallback) that says which one worked, a note on the Windows Chrome flag (`chrome://flags/#enable-unsafe-webgpu`), and an opt-in **Timing** button (lower right) that measures frame intervals on the visitor's own machine; nothing runs until it is pressed and nothing is uploaded.

Parity against X_ITE 16.6.0 (headless Chromium, software adapter, 640 x 360, correctness only, nothing timed), same on v1 and v2: everything on 33.03 dB, glass cortex 35.11, wet cortex 30.50, deep structures 31.49, tracts 22.51, MRI slices 25.74, labels 21.53, activation 34.75, torso CT 30.25. The receipt and scripts are in x3d.loom `runs/webgpu-brain-v2-20261107/`.

No frame times are claimed for this page. The Timing button is how the numbers will come from real machines.

Notices: `NOTICE.md`, `NOTICE-BRAIN-DATA.md` and `NOTICE-TORSO.md` are byte-identical to v1's. The page is a synthetic illustration, not medical advice.
