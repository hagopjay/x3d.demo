# Demo 62: x3d.wgpu in the browser (v1)

The Rust renderer from hagopjay/x3d.wgpu, compiled to WebAssembly (crate `x3d-web`) and driven by `index.html`.
Built with `web/build.sh` from x3d.wgpu PR #6 (commit 2f8a004): rustc 1.97.0, wasm-bindgen 0.2.130, profile `web`.
Sample scenes are `scenes/01..07` from that repository. Licence: MIT OR Apache-2.0.

Checked in headless Chromium on SwiftShader (CPU): the WebGL2 path renders; the WebGPU path starts but headless cannot present it, so WebGPU pixels were not seen by the builder.
