# Giza VI: notices and credits

## What this folder is

Giza VI merges four editions into one narrative: the v3 Evidence Atlas, the Hawara Witness Atlas v4.1 (`../v4/`), Giza IV Horizon Engine (`../v4-horizon/`) and Giza V Earth's Tesla Coil (`../v5/`). Those folders are shipped unchanged beside this one; v1 to v3 are untouched. Giza VI imports four of their modules at runtime instead of copying them:

| Module | From | Used for |
|---|---|---|
| `../v3/sky-math.js` + `../v3/stars_v2.json` | v3 Evidence Atlas | precession sky, star positions, belt altitudes |
| `../v5/tesla.mjs` | Giza V | the live energy ledger (12.5 GJ bank, supply, arcs, losses) |
| `../v5/resonance.mjs` | Giza IV/V | the dimensionless oscillator curve in Act III |
| `../v4/hawara.mjs` | Hawara v4.1 | the seven Hawara chapters (imports `../v4/review-core.mjs`) |

Keep the whole `giza-osiris-hall/` tree together.

## Grades

Every caption, mesh and ledger row carries one of four marks: **Confirmed** (a published measurement or record, opened by this or an earlier edition), **Likely** (computed here from sources, or a supported interpretation), **Suspected** (claim, conjecture or contested reading), **Authored** (invention for the story). Authored is not a truth grade; it marks fiction. The king, the luminous ankh and Was-sceptre coupling, the planetary coil, its arcs, sky sheet, beacons and the encounter are Authored. VISOR is a rendering look applied to the model; it shows no sensor data.

## Third-party software and data

- **Babylon.js 8.56.2** (`vendor/babylon/babylon.js`) and **Babylon.js materials 8.56.2** (`vendor/babylon/babylon.skyMaterial.min.js`), Apache License 2.0, copyright Babylon.js contributors; licence text in `vendor/babylon/LICENSE.md`. Fetched from the npm registry on 18 Nov 2026; SHA-256 recorded in `VALIDATION.md`.
- **X_ITE 16.6.0** draws `twin.html`; it is the copy bundled with v3 (`../v3/vendor/x_ite/`, its own licence file).
- Star catalogue: **HYG database v4.1** by David Nash, CC BY-SA 4.0 (<https://codeberg.org/astronexus/hyg>), as prepared in v2/v3; named-star coordinates from CDS Sesame; precession matrices from ERFA (Vondrak 2011 long-term model). Sampled by v3; reused unchanged.
- The Milky Way points are decorative: their positions follow the real galactic plane (IAU galactic-to-ICRS rotation) but their brightness is invented and they are not a catalogue.
- Monument positions: v3 `build/geo.py` (rounded published centre coordinates). Coordinates for the Giza to Hawara distance: the Wikipedia pages "Great Pyramid of Giza" and "Hawara", opened 18 Nov 2026.

## Original content

The Giza VI code, geometry recipes, story text and ledger arrangement were written for this folder (x3d.demo, 18 Nov 2026) and follow the licence of the x3d.demo repository. Source texts quoted or summarised in the ledger keep their authors' rights; links point to them.

## Not claimed

No survey, no new archaeological measurement, no radar or thermal data, no electrical generator, no alien or divine machine, no dated solar ephemeris. The X3D twin carries the same vertices and grades; it is not a survey reconstruction.
