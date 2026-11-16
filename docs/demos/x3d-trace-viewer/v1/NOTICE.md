# Notice: Trace viewer (x3d-trace-viewer/v1)

The credit wording on the page itself is the site owner's decision; this file states what the folder contains and where it came from.

## What is in the folder

- `index.html`, `viewer.js`, `check.js`: the page. Plain JavaScript, no build step, no network call except the vendored X_ITE
  file named below. No model, no paid service: every verdict is plain code (FIND, COMPARE, LOCATE).
- `data/e2-cornell-box.x3d`: a copy of `notebooks/unreal/colab_g4/scenes/e2-cornell-box.x3d` from hagopjay/x3d.lab, unchanged
  (its own `meta creator` line reads "HagopJay and Claude, x3d.lab G4 experiments, 15 Nov 2026").
- `data/pins.toml`, `data/tests.yml`, `data/unreal-README.md`: copies of `src/x3dlab/pins.toml`, `.github/workflows/tests.yml`
  and `notebooks/unreal/colab_g4/README.md` from hagopjay/x3d.lab, unchanged, used as the "rig" source texts.
- `data/claims.json`, `data/report-*.json`, `data/places-*.json`, `data/checks.json`: written by `build/build_trace.py`
  (deterministic: same inputs, same bytes) with the x3dtrace engine from hagopjay/x3d.ML (single stdlib file, sha-256
  dcba70d7...). The claims are written by hand for this demo; they are not output of a model run.
- `build/`, `test/`: the builder, a headless-browser check, a unit check, and the X_ITE bounding-box probe used to pre-compute
  the boxes.

## X_ITE

Not copied. The page loads `../../blender-x3d-io/v1/vendor/x_ite/x_ite.min.js` (X_ITE 16.6.0, MIT, Holger Seelig and other
contributors; licence text in `../../blender-x3d-io/v1/vendor/x_ite/LICENSE.md`). `?xite=<url>` overrides the path.

## Method and credit

The check follows the method in Umair Ali Khan's Medium article "How I Added Traceability in Structured Data Extraction with
AI": the writer (here, the author of `claims.json`) copies a short exact quote beside each value, and plain code then finds the
quote in the source, compares the value with it, and says where it is. The verdict names (verified, check, reworded,
unchecked), the coverage figure and the trace policy follow the `source_tracing` component of the GAIK toolkit
(https://github.com/GAIK-project/gaik-toolkit, MIT). `check.js` is a small JavaScript port of the core of the x3dtrace engine in
hagopjay/x3d.ML, which is an independent implementation written from a behavioural description: no GAIK source file or function
body is copied. That engine's conformance file does carry a few example value/quote pairs from GAIK's tests and README, so the
GAIK notice is reproduced here, as it is in x3d.ML's `NOTICE-x3dtrace.md`. The claims in this demo are written by hand and are
not output of a model run. Whether and how to name the article and GAIK on the public page is still open.

    MIT License

    Copyright (c) 2026 GAIK - GenAI for knowledge mgt

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
    files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
    modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
    Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
    WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
    COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
    ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Licence of this folder

The site has no LICENSE file at the root (x3d.demo, x3d.lab), so no licence is claimed here. Pending the owner's choice.
