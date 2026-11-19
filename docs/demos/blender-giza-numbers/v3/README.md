# Pyramid Observatory v3: The Reveal

Demo 65, third edition. It merges three things:

- **v2**, the outside review's Pyramid Observatory (`../v2/`, kept as delivered), with its instruments, startup fix and evidence atlas.
- **v1**'s theatre: the big gold digits the owner asked for ("act like that's a big deal").
- **New v3 work**: The Reveal, the Coincidence Engine, the eclipse sky and a Blender round-trip witness.

Run it from the repository root with `python -m http.server 8000 --directory docs`, then open `http://localhost:8000/demos/blender-giza-numbers/v3/`.

## What v3 adds

| Part | What it does | Grade of its claims |
|---|---|---|
| **The Reveal** (top) | Five acts: the 29.9792458° latitude and c, π, φ, the Sun's 864,000 miles, and the Louvre Pyramid's "speed of light". Each act opens in the **Wonder** lens: the claim in rolling gold digits, told straight. The **Test** lens then sets the measured number below it and keeps gold only the digits that match **character for character**. A grade stamp follows, and "Test it in the instrument" opens the matching v2 instrument. Auto-plays, pauses on any touch, and respects reduced motion. | Each act carries its own grade: False, Confirmed, Likely, Confirmed or Authored. |
| **Literal digits** | Fixes review finding P1. 1,079.57 against 1,080 is 2 literal digits, though it is 4 after rounding. The page shows both numbers and colours only the literal ones. | Confirmed: unit test |
| **12 Coincidence Engine** | Measures a pyramid every way a numerology chart does: 10 length units, inverses, length ratios, latitude and longitude. It checks each result against 16 constants and counts hits. It also prints how many hits chance alone predicts (log-uniform mantissa: P = log₁₀(1 + 10¹⁻ᵈ/t_d)). Five monuments are offered, plus "your pyramid". At 4 digits chance predicts 0.70 per monument. Found: Khufu 1, Khafre 2, Menkaure 3, Red 0, Louvre 1. | Confirmed for the counts; the chance model is a yardstick, not a p-value |
| **13 The sky's own coincidence** | Sun and Moon angular diameters, with a time slider. Total eclipses end in about 617 million years at today's recession rate, extrapolated linearly. The 864 / 432 / 108 family appears in miles and vanishes in km. The table gives literal digits. | Likely for the time axis (the rate is not constant) |
| **15 Blenderizer witness** | v2's scene was imported into Blender 5.3 with x3d-blender-io 8310e7b and exported again as X3D 4.0. The returned file is valid (x3d_mcp 39c6e94: XSD valid, 0 errors, 0 warnings). Geometry, cameras, lights and textures survive. Switches, DEF names, billboarded text and the TextureTransform do not. A Cycles still of the round-tripped .blend is the page backdrop. | Confirmed: `receipts/blender-roundtrip.json` |

v3 loads v2's scene (`../v2/assets/observatory.x3d`) and v1's claim receipt. Nothing in v1 or v2 was changed.

## Files

- `wonder-math.mjs`: literal digits, the chance model, the engine and the eclipse sky. Pure, and tested in `tests/wonder.test.mjs`.
- `wonder.mjs`, `wonder.css`: the v3 sections. They drive the v2 instrument only through its own buttons.
- `observatory.mjs`, `lab-math.mjs`, `renderer.mjs`, `observatory.css`: v2 code. The only change is the scene path.
- `build/roundtrip_observatory.py`: the Blender import, census and re-export. Run `python roundtrip_observatory.py ../v2/assets/observatory.x3d OUT x3d-blender-io/source` with the bpy wheel.
- `build/cycles_hero.py`: the backdrop still (Cycles CPU, 64 samples, seed 7). The TextureTransform tiling lost in the trip is restored by hand for this still, and the receipt says so.
- `receipts/blender-roundtrip.json`: the census, the validator result and the importer finding.

## Checks run (19 Nov 2026)

- `node --test tests/*.test.mjs` passes 38 of 38: v2's 32 tests run against v3, plus 6 new ones. Those include a 200,000-sample Monte Carlo check of the chance model. The DOM suite needs `LINKEDOM_PATH` (see `../v2/README.md`).
- `python tests/check_integrity.py` passes: 32 DEFs, 28 SAI nodes, 20 local references, and the v2 scene rebuilt byte-identical.
- Browser rig: Playwright headless Chromium 157.0.8103.78 with SwiftShader, X_ITE 16.7.1, at 1366 px and 390 px. No console errors, no failed requests, no horizontal page scroll. All five acts were checked in both lenses, and "Test it" opens the latitude instrument.
- Not checked: a real GPU, a real phone, or Firefox and Safari.

## Findings for the add-on (folded into x3d.loom)

1. Round-tripped DEF names come back prefixed (`CA_Overview` becomes `OB_CA_Overview`), so a page's `getNamedNode` calls all miss. Confirmed.
2. Switch, Group, WorldInfo and TextureTransform are not written back. Text comes back as meshes. Confirmed.
3. The importer warns "Color has 1600 values but is indexed up to 1680" and "TextureCoordinate has 3 values but is indexed up to 4" on a correct scene. `_index_need` also counts coordIndex when colorIndex or texCoordIndex governs. The padding is harmless. Confirmed (import_x3d.py lines 2301 and 2359).

Credits: v2 by the owner's outside review agent; Daniel Mayer's photograph (CC BY-SA 4.0) stays in v1 with its attribution. GPL-3.0-or-later.
