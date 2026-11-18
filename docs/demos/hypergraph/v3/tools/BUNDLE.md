# Rebuilding bundle.js and data

```
pip install python-chess            # python-chess 1.999 / chess 1.10.0 was used
python3 tools/build.py               # source/*.tsv -> data.json + hypergraph.x3d
npm i @babylonjs/core@9.37.0 esbuild@0.28
npx esbuild src/main.js --bundle --minify --format=iife --target=es2020 --outfile=bundle.js
NODE_PATH=... node tools/smoke.js <outdir> receipt-browser.json   # Playwright, needs a local static server on :8139
```
`bundle.js` is esbuild output (Babylon.js core deep imports only, 1.4 MB). Babylon.js is Apache-2.0. X_ITE (xite.html only) is bundled under `vendor/x_ite/` with its own LICENSE.md.
