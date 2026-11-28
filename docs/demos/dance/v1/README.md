# x3d.dance v1 (Demo 84): HAnim 2.0 dancers Ada and Rex

The lab from hagopjay/x3d.dance (built by hagsMac) at main `0937b78`, served as static files. Open `index.html` over http. Pick a demo groove (house, hip-hop, funk, all synthesised in the page) or drop in your own audio; the dancers listen, groove, and learn from your thumbs.

| What | Value | Source |
|---|---|---|
| Stage | `stage-4.1.x3d`, sha256 `4f13e1252bf7`, X3D 4.1, 2 HAnim LOA-4 skinned humanoids | x3d.dance `web/` |
| Validation | XSD valid, 0 errors; semantic check 0 errors, 13 weight-0 skin warnings | x3d_mcp `ca0e75c` |
| Page test | loads with 0 console errors and 0 missing files; 6 genomes per dancer shown | headless Chromium, SwiftShader, X_ITE 16.8.1 (`shot.png`) |
| Not measured | real GPU, phones, other browsers, live microphone, speakers | |

## Credit and takedown
- Dancer bodies: MakeHuman assets, CC0 (MakeHuman team / Data Collection AB).
- Viewer: X_ITE 16.8.1 (MIT, create3000), only the parts the page loads, in `vendor/x_ite/` with its LICENSE.md.
- HAnim joint values: ISO/IEC 19774-1:2019 as reproduced in x3d.py and coderextreme/x3dschema.
- No music or motion capture is included.
- To have anything removed, open an issue on hagopjay/x3d.dance; it will be taken down promptly.
- Code: MIT (`LICENSE-x3d.dance.txt`). Learnings: x3d.loom `LEARNINGS-dance.md`, failure modes 516 to 518.
