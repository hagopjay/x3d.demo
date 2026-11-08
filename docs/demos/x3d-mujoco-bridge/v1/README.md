# X3D ↔ MuJoCo · Authoring Bridge (experimental 0.1)

Author an articulated arm in X3D, simulate it in MuJoCo, and bring the poses, forces and experiment records back into the scene. Physics is real MuJoCo 3.17.0 compiled to WebAssembly; the scene is drawn by X_ITE 16.7.0. Both are bundled here: the page makes no network requests.

- Drag the cyan sphere to set a controller goal, the orange sphere to author an obstacle; press **Run physics**.
- **X3D scene ↓** and **Experiment package ↓** export what you built.

This is the prebuilt app (`dist/`) of the x3d-mujoco-proto-bridge project, copied unchanged. Third-party licences (MuJoCo, Apache-2.0, and the rest of the build) are in `THIRD_PARTY_NOTICES.txt`; X_ITE's are in `vendor/x_ite/LICENSE.md` and `vendor/x_ite/LICENSES/`. It is a bounded `contact-arm/1` profile, not a general scene converter or native X3D physics.
