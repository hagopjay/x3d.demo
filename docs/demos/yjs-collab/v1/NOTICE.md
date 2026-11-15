# Yjs collaboration on X3D: sources and checks

**What it is.** Three peers (Alice, Bob, an agent) each hold their own copy of one animated X3D scene as a Yjs document and exchange only small update messages over an in-page link with an adjustable delay. The scene is drawn by X_ITE 16.6.0 (bundled under `vendor/x_ite/`, own LICENSE.md). There is no server and no network request. The "agent" is a scripted list of operations run through the real operation applier; no model is called.

**Built from** x3d.loom `x3d.yjs/` (PR #74): `src/yx3d.js` (the model), `src/sai-adapter.js` (applies changes to X_ITE through the SAI), `src/agent.js`, `src/link.js`; the page is `x3d.yjs/demo/showcase/index.html` with two path changes (`./dist/yx3d.js`, bundled X_ITE). `dist/yx3d.js` is `node tools/build.js` output (esbuild 0.28, minified, includes Yjs 13.6.33 and lib0).

**Checks (Confirmed, run 15 Nov 2026, headless Chromium 153.0.8010.12, SwiftShader software GL, X_ITE 16.6.0).** `tools/showcase-e2e.js` plays the story: the three document hashes differ during the split and are identical afterwards; the node names reachable in X_ITE equal the document on all three peers; the rescue button empties the orphan list; no page errors. Receipt: `x3d.yjs/receipts/showcase-e2e.json`. Timings on this page are the visitor browser on an in-page link, not a network; the measured benchmark tables are in x3d.docs chapter 15.

**Not claimed:** wire latency over a real relay; behaviour with many peers; per-axis merge of a vector field (two peers editing one `translation` get one winner).

## Licences of bundled libraries

### Yjs 13.6.33 (MIT)

The MIT License (MIT)

Copyright (c) 2023
  - Kevin Jahns <kevin.jahns@protonmail.com>.
  - Chair of Computer Science 5 (Databases & Information Systems), RWTH Aachen University, Germany

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### lib0 (MIT)

The MIT License (MIT)

Copyright (c) 2019 Kevin Jahns <kevin.jahns@protonmail.com>.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
