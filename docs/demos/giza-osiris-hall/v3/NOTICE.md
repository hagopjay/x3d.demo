# Giza Evidence Atlas: enhanced edition

This edition extends the supplied **Giza v2: the Osiris Shaft, the Hall of Records and the sky** X3D study. It retains the original local scene, supplied source cards, catalogue data, raw light bakes and bundled X_ITE 16.6.0 renderer, while adding investigation controls, explicit geometry status and reproducible observation settings. The scene remains schematic; the enhancement produces no new archaeological field measurements.

`BASELINE-NOTICE-v2.md` preserves the uploaded notice **byte for byte**. It records the original edition's assertions, checks, source-handling history and credits, including wording corrected here. Its SHA-256 is `abd5716ce8bc829aad5cd904becb2fab0e9c5be049742bb5a2a43438116425c2`. Read this notice for the enhanced edition and the preserved notice for the historical record.

## What this edition changes

- Separate documented, theorized and speculative layers remain selectable. Speculation starts hidden; named speculative views can enable their relevant layer. A persistent context panel distinguishes the selected subject's evidence tier from the geometry's modelling status. Free camera movement can reveal several tiers at once.
- A local survey overlay, compass, datum and reference rings accompany a north-side clipping section and a depth-comparison theatre. Added viewpoints include survey, depth comparison and imagined Hall detail. The additional Hall ornament is explicitly invented.
- Sky controls use astronomical-year labels, an independent local sidereal-time setting, a named-star probe and continuous precession playback. `sky-math.js` projects rounded sample matrices to right-handed orthonormal rotations and interpolates them with shortest-arc quaternion SLERP. The matrices' ERFA/Vondrak provenance is inherited from the supplied data; this pass does not independently recompute them with ERFA.
- Exposure, resolution presets and focus mode support visual inspection. A twelve-slot browser-local camera notebook, view links, session import/export and JSON reports preserve supported observation settings. Reports include available asset hashes and distinguish historical validation from current structural checks.
- `STUDY-AUDIT.md`, `SKY-MODEL.md`, `evidence-index.json`, regression checks and the field guide make the interpretation and software contracts inspectable. The source cards and their historical opened/read flags retain their own scope; visible edition notes qualify the sky count and Khafre radar claim without rewriting those source records.

## Quantities, geometry and provenance

The local right-handed frame uses metres: **+X east, +Y up, +Z south**, with a schematic Sphinx origin and a flat model datum at Y=0. Underground positions in plan, chamber orientation, many dimensions and the surface context are simplified or invented as described in the baseline notice and the current evidence index. This is not a surveyed control network.

The Osiris shaft drops reported by Hawass are **9.62 + 13.25 + 7.50 = 30.37 m**. The **35.45 m** label in the published section uses the figure's ground datum. These are different quantities with different reference conventions, rather than rival measurements from one origin. The depth theatre normalizes endpoints for comparison; it is not a new survey section. The deep Khafre “648 m” visualization remains a disputed proposal, and the Hall of Records geometry, ornaments and depth remain imagined.

Evidence tier, geometry status and source-handling grade are distinct. In the supplied cards, “Confirmed” denotes a source opened and read; it is not a verdict that each claim is true. The baseline records 75 cards and 128 distinct source URLs, with 125 marked opened. That is a historical research record, not a claim that this enhancement reopened all links. The narrower checks made for this edition are identified in `STUDY-AUDIT.md` and `evidence-index.json`.

## Sky and appearance

The bundled data contain **978 field-star records, 40 named-star records and 152 epoch samples**, covering astronomical years −13000 through 2100. The baseline notice's “41 named” count was incorrect. Astronomical year 0 is 1 BCE; −10499 is 10500 BCE. The field catalogue is incomplete. Proper motion, refraction and a civil-time apparent-place pipeline are outside the current model; `SKY-MODEL.md` describes its numerical and astronomical limits.

The camera-to-`SkyRig` translation ROUTE already existed in the uploaded scene and generator. It is preserved here, rather than presented as a new fix. It keeps a finite-radius star shell centred on the moving observer, avoiding artificial travel parallax.

Three supplied Blender Cycles bakes provide morning, midday and afternoon appearance. The source state id `sunrise` uses azimuth 90° and elevation **+7°**; it is an illustrative morning state, independent of sidereal time and not a dated solar-rise calculation. Each bake has its recorded display normalization. The night state is blue-toned dimmed albedo, not a fourth Cycles bake. Exposure and image sampling change presentation, not light transport or archaeological accuracy. Original bake receipts remain in `states.json`.

## Lineage and v3 validation

This folder is v3 of the Giza study (v1 and v2 sit beside it, untouched). `giza-atlas-v3.x3d` is the Evidence Atlas scene under a new name, byte for byte. `validation-v3.json` is the fresh full XSD, semantic and profile receipt for it (x3d_mcp `fa5dccf`: XSD valid, 0 errors, 0 warnings); the paragraphs below describe the older baseline receipt and are kept as written.

## Validation scope

`validation.json` is the **historical supplied-v2 receipt**. It reports XSD 4.0 validity, zero semantic errors, zero warnings and 124 informational notes for the original 2,456,501-byte scene. The original scene's complete SHA-256 is:

```text
877aff00acd595f72e170888f6d5efc29215d92750e97c8d63df2d678e5fe799
```

The receipt stores only its first twelve hex characters. It does **not** certify the changed enhanced scene. `build/scene-structure.json` records the current structural XML and deterministic rebuild checks with its scene digest; it is not an XSD result or a browser-render test. Consult `VALIDATION.md` for the exact additional commands, results and browser observations completed for this edition. The runtime JSON report keeps these scopes separate. An independent full XSD/semantic gate remains available through `build/gate.py` with an external `x3d_mcp` installation.

## Credits and licences

The original generated geometry is CC0, as stated in the supplied notice. The derived star catalogue uses **HYG database v4.1 by David Nash**, <https://codeberg.org/astronexus/hyg>, and remains **CC BY-SA 4.0**. The supplied bright-star coordinates are attributed to CDS Sesame, and the sampled precession matrices to ERFA and Vondrak's long-term model. Third-party source texts and claims retain their authorship.

The bundled **X_ITE 16.6.0** renderer retains its included licence at `vendor/x_ite/LICENSE.md`. The original research and bake attributions remain in `BASELINE-NOTICE-v2.md`, `research-log.md`, `stars_v2.json` and `states.json`. Rendering the Cayce, Orion Correlation and deep Khafre proposals does not supply evidence for them; the interface keeps their supporting arguments, rebuttals and modelling status accessible.

## Reading and running

Start with `README.md` or `HOW-TO-RUN.txt`. Run `python3 serve.py`, `py -3 serve.py` on Windows, or the included launch scripts, then open **http://127.0.0.1:8800/**. `GIZA-FIELD-GUIDE.html` provides the technical guide and experiments; `build/README.md` separates an ordinary scene rebuild from optional catalogue, bake and validator workflows. `GIT-PATCH.md` explains how to apply `Giza-Evidence-Atlas-upgrade.patch` to an extracted copy of the original study.
