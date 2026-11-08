# x3d.demo changelog

The demo doc is the page served at the site root. Every version is kept: `docs/versions/vN/index.html` is a frozen snapshot, and `docs/index.html` is a copy of the newest one. Demos are versioned the same way (`docs/demos/<name>/vN/`). Nothing is overwritten; a change makes a new version.

## v14 (2026-11-08)
- Removed the "A Claude artifact" card from the shelf: its link was a private artifact page, which should not be on a public page. The v13 snapshot is frozen and still carries it (see the note to the owner); this version and the live page do not.
- The x3d.STEM shelf card links to the repository's own Pages site (https://hagopjay.github.io/x3d.STEM/, live since 7 November).
- No demo changed.

## v13 (2026-11-08)
- New Demos 12 to 17, all X3D drawn by X_ITE (WebGL), each self-contained with its X_ITE bundled:
  - 12, Checkable 3D: the Blender X3D I/O showcase, twelve live scenes (`demos/blender-x3d-io/v1/`).
  - 13, X3D ↔ MuJoCo authoring bridge, with real MuJoCo 3.17.0 in WebAssembly (`demos/x3d-mujoco-bridge/v1/`).
  - 14, the X3D Ontology as a constellation (`demos/ontology-constellation/v1/`).
  - 15, Dynasty Loom, an atlas of three families (`demos/dynasty-loom/v1/`).
  - 16, Confluence, IFC ↔ X3D, as a read-only copy that replays one recorded revision of the live studio (`demos/confluence-ifc/v1/`).
  - 17, Gobbler, a cabinet of worlds (`demos/gobbler-worlds-within/v1/`).
- Shelf: a link to a Claude artifact. It needed a sign-in when added; the owner will make it public.
- Checked in a headless browser on a software GPU, correctness only:
  - every page loads with no failed requests;
  - all 24 showcase scenes load (`annotation.x3d`'s unknown node is that demo's subject);
  - the bridge's physics runs;
  - the IFC copy loads from a subpath with no server;
  - Gobbler's Pantheon loads.
- Not checked: listening, real GPUs, other browsers, timings. Provenance and hashes are in `docs/demos/SOURCES.md`.

## v12 (2026-11-07)
- New Demos 10 and 11: Chirp and Electron Cloud Observatory on Babylon.js 9.32.0 WebGPU (`docs/demos/chirp-webgpu/v1/index.html`, `docs/demos/electron-cloud-webgpu/v1/index.html`). Each is one offline file built from x3d.loom PR #21 (commit d323213, still open when built) with `build-chirp.py --kind chirp|cloud --study docs/demos/stem/v1/<study> --single`; the X_ITE study pages (`demos/stem/v1`) are untouched and each Demo 5 card links to its WebGPU version. Cards state the logged parity gaps and what was not checked (audio on Chirp, other browsers, real GPUs); no Timing button yet.
- Both pages ran in a headless browser on a software WebGPU: each study's own browser witness passed, no console errors.

## v11 (2026-11-07)
- New Demo 9: the Manifold of emotion on Babylon.js 9.32.0 WebGPU (`docs/demos/manifold-webgpu/v1/`, built by the x3d.loom PR #19 manifold thread with `build-manifold.py --site`; the shipped site tar had sha256 ef55572ad4d950a24b672570e47cdc42ecc8d43073d1204b615ad215ea52abb5 and was copied unchanged). The X_ITE manifold (Demo 4, `demos/manifold/v1`) is untouched and linked as its non-WebGPU twin, and Demo 4 now links here. Opt-in Timing button on the page; no timing exists yet. Card text carries the 49.3 and 48.5 dB software-GPU comparisons and says what was not run.
- Demo 3 gains a link to Neural Canvas v2 (`demos/brain-torso/v2/`, added by PR #11: same pixels, adapter retry, Windows flag note, opt-in Timing button); v1 stays.
- Not yet: KANSEI v1.1 (texture-request fix on the platformer site) answered 404 when this was built, so Demo 6 still points at v1.

## v10 (2026-11-07)
- Demo 7 Loomsong is now playable at `docs/demos/loomsong/v1/` (x3d.music at 4a7bdbd: worlds and page rebuilt with `gen/world_ode.py`, `gen/world_turca.py` and `page/build_page.py --no-audio`; the worlds came out byte-identical in size to the preview's; page wrapped in a full HTML document, the host report switched off; audio masters and the four animated cards are the preview version 2 files, sha256 in SOURCES.md). NOTICE.md and LICENSE travel with it; CC BY-NC-SA 4.0 for everything derived from the Alla Turca score.
- New Demo 8 Tether Firehose 4 (x3d.ML demo/v4 at a2bddac, built with `build_v4.py --share`, X_ITE 16.5.1 added as its own files). The share build's SAFE map removes lane names, hardware and run costs; its sweep said clean, and the served text was checked again by hand.
- The shelf adds x3d.ML and a Play link for x3d.music.
- Verified in a headless browser (software GPU, no timings): both pages load with no console errors and no failed requests; Loomsong plays with sound start on a click.

## v9 (2026-11-07)
- Demo 7: Loomsong (Beethoven's Ode to Joy and Mozart's Rondo alla Turca as machines), source only: hagopjay/x3d.music has no Pages site, its README says publishing has not started, and the audio masters are not committed. The card says so, repeats the repository's "no human has listened yet", and carries the non-commercial licence that the Alla Turca score imposes.
- New shelf "More from GitHub, since 7 October": live sites (PolyXandria demos on x3d.poc, x3dom.fun, Mashtots System 2, KeGG, Dirac, KANSEI) and source-only repositories (x3d.music, x3d.loom, x3d-blender-io, x3d_mcp, x3d.xray, x3d.onto, x3d.STEM). Every live link answered 200 when linked. Forks of other people's projects and private repositories are left out. x3d.ML is not linked until its owner decides about a data file it serves.
- The x3d.STEM front page link on the hagopjay Pages domain was replaced by the manifold's original site: that front page answered 404 when v9 was built (it answered 200 earlier on 7 November). Nothing hosted here depended on it.
- Demos 1 to 6 unchanged.

## v8 (2026-11-07)
- Demo 6: KANSEI, the Babylon flagship (a night-drift game, Babylon.js 9.32.0 on WebGPU through our own X3D reader). It is hosted in its own repository, hagopjay/platformer, at https://hagopjay.github.io/platformer/kansei/v1/ (answered 200 when linked), so this page links to it and copies nothing. Preview image is the Babylon half of a recorded comparison sheet (software GPU, correctness only) from x3d.loom `runs/webgpu-drift-20261107/`. Source: x3d.loom PR #17.
- Demos 1 to 5 unchanged.

## v7 (2026-11-07)
- Demo 5, STEM studies, now run live: Chirp, Electron Cloud Observatory, Turing Garden, Living Heart, Vortex Reconnection & Sound (`docs/demos/stem/v1/<study>/`). The x3d.STEM repository does not commit the studies' data files, so each study's own builder was run (`python3 -E -s tools/<builder>.py`, numba and numpy, CPU) and its output bundled. Every case: all witnesses green (Vortex 10 and 11, Living Heart 8, 7 and 10, Turing Garden 14, 14, 14, 14 and 12, Chirp and Electron Cloud green). Each page then verified its data against the repository's recorded hashes, and its in-browser meshes against the builder's (41 of 41, 36 of 36, 48 of 48 frames), in a headless browser on a software GPU. Kerr 2 is not hosted (about 330 MB of images); it stays a source link.
- Demo 4, the manifold, is now hosted too (`docs/demos/manifold/v1/`, from the repository's `studies/manifold`; five key files identical by hash to the original site). The debrief's comparison frames and the builders are left out of this copy.
- X_ITE twin of Neural Canvas (`docs/demos/brain-torso-xite/v1/`): the page the WebGPU version was ported from, X_ITE 16.6.0 bundled, same notices. Demo 1 links the collider's X_ITE twin on the dirac Pages site.
- Demos 1 to 3 (WebGPU) unchanged.
- Fix after merge: the X_ITE twin's bundled X_ITE files were left out of the first push by the page's own `.gitignore` (the page worked through its CDN fallback). They are now in `docs/demos/brain-torso-xite/v1/vendor/` and the ignore file is removed from the hosted copy. No page file changed.

## v6 (2026-11-07)
- Demo 4: Manifold of emotion (X3D 4.0, drawn by X_ITE 16.5.1, not WebGPU). It lives on a sibling repository, x3d.STEM, so the doc links out to it and shows a screenshot (`docs/assets/manifold.jpg`, drawn on a software GPU, status strip cropped out). Nothing from it is copied into this repository.
- New STEM shelf: the six x3d.STEM studies (Kerr 2, Turing Garden, Electron Cloud, Chirp, Living Heart, Vortex Reconnection & Sound), linked to their source and evidence in hagopjay/x3d.STEM, not to live pages: their data files are not committed, so the published study pages stop at "could not be shown" (checked in a headless browser, 6 of 6 give 404 on their data files). They can point at live pages once the data is published.
- Demos 1 to 3 unchanged. The lede now says which demos need WebGPU.

## v5 (2026-11-07)
- Demo 3 is now Neural Canvas, the brain and torso CT drawn with Babylon.js on WebGPU through our own X3D reader (built from x3d.loom PR #13 with `build-brain.py --single`). It replaces the placeholder. Sources and licence grades are in `docs/demos/brain-torso/v1/NOTICE*.md`. The cortex shapes come from TemplateFlow fsaverage, whose licence is graded Suspected (no licence file found); it is shown for educational use at the owner's direction and may be removed if the rights holder asks.

## v4 (2026-11-07)
- Added the meme wall: eight captioned frames of the demos (`docs/assets/memes/`). Demos unchanged.

## v3 (2026-11-07)
- The v2 adapter fallback did not help on the reporting machine: its `chrome://gpu` (Chrome 156, Intel UHD 620, Windows) lists the Intel adapter under Dawn Info as "Blocklisted - D3D11 backend not fully implemented" and the only other adapters as a blocklisted CPU renderer, so every `requestAdapter()` returns null. The v1/v2 demo pages are unchanged; they cannot run there until Chrome offers an adapter.
- Doc page: when there is no adapter it now explains the blocklist and the one thing to try (`chrome://flags/#enable-unsafe-webgpu`, then relaunch), plus Edge or a Mac. Untested on that machine.

## v2 (2026-11-07)
- Fix: the v1 demo pages gave up with "requestAdapter() returned no adapter" on a machine where a plain `requestAdapter()` works. They asked only for the high-performance hint. The v2 pages try the plain request first, then the hint, low-power and the software adapter. Reproduced in a headless test (v1 shows that exact error when only the plain request answers; v2 loads). Cause on the reporting machine is Likely this, not confirmed.
- Doc page check now runs both requests and shows each result.
- Demos are v2 (`docs/demos/*/v2/`); the v1 pages and doc stay in place.

## v1 (2026-11-07)
- First page. Demos in the order asked for: 1 Collider events (five pages), 2 Heritage facade splats, 3 Torso CT (placeholder).
- Page checks WebGPU in the visitor's own browser and shows the adapter, locally only.
- Sources: x3d.loom PR #12 (`x3d.webgpu/demo/src/build-events.py`, `build-v3.py`). Scene hashes are in `docs/demos/SOURCES.md`.
