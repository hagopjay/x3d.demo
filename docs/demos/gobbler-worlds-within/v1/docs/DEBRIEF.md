# Gobbler: the cabinet and the contract

**Technical and creative debrief · 3 November 2026**

The result is a more deliberate way to encounter the Gobbler: a creature that contains places, and a viewer that can explain what it loaded, why it moved, what it measured and where its claims stop. The most valuable discoveries came from failures at boundaries—geometry versus shader, intention versus observation, and a historic receipt versus current bytes.

The source collection already has a powerful identity. This work preserves its dense ornament, the 2,476-star graph, the existing 439 host shapes and the complete 50,058-splat Pantheon. It does not replace the collection with a simpler generic viewer. It improves the conditions under which the complexity becomes intelligible.

## The evidence we actually had

The supplied ZIP is a deployment export: HTML, JavaScript, compressed scene data, four nested worlds, textures, two music beds and a bundled X_ITE runtime. It does not contain the complete original authoring repository, Blender scenes, all generation tools, or the music-generation provenance manifest mentioned in the comments. `source/input-manifest.json` records every supplied archive member. `source/reference-documents.json` binds the three companion documents by hash.

The design study proposed intent prefetch, unloading hysteresis, smaller splat/mesh transport and clearer destinations. The Grand Review and Tether Lecture argued for multiple imperfect witnesses, explicit simulation labels, corpus-bound statistics, numeric validation beyond XSD, and image judges that flag rather than grade. Those are inputs to this run, not experiments rerun by it. Historical mutation counts, validation rates and GPU timings from those documents are not presented as new measurements.

One concrete discrepancy mattered immediately: the supplied historical receipt describes a 1,663,991-byte scene. The supplied decoded scene is 1,714,665 bytes and has a different SHA-256. The page nevertheless displayed “valid X3D 4.0.” The upgraded page says **Scene hash verified** only when its fetched XML matches the new build receipt. This is an identity statement, deliberately separate from conformance, image quality and historical accuracy.

## The architecture we changed

The original viewer has useful separation between boot, graph hover, camera, audio and scene assets. Its weak point is ownership. Proximity sensors write `Inline.load`; navigation writes camera fields; UI and audio infer location later. A load is triggered, but nothing explicitly owns its departure. A successful command can be mistaken for an observed arrival.

The upgrade retains that working scaffold and adds a small, testable residency core plus an X_ITE adapter. `WorldStore` owns state transitions, epochs, the two-group budget, active-world protection, destination intent, failure and grace-period eviction. `LoadSensor.children` witnesses the load of each root group. The adapter creates and disposes its sensor, rejects cancelled generations and sets `Inline.load=false` when evicted. Unloading is a request to the renderer; it is not a measured claim about VRAM reclamation.

A group can contain several Inlines. Earth/village is one group with five root Inlines; the other destinations use a world Inline and its sky. Nested Giza assets remain descendants. “Two resident groups” therefore does not mean two HTTP requests, two GPU allocations or a fixed memory ceiling. That distinction belongs in every resource receipt.

The visible world stays pinned while a new destination loads. Arrival commits the destination only after the camera flight completes. A separate `ArrivalLatch` waits for the camera sensor to observe that destination before proximity can become authoritative again. This prevents a delayed observation of Giza, for example, from undoing a commanded arrival at the Pantheon. Input interruption cancels the pending camera promise, increments its generation and releases destination intent.

At depth, 66 explicitly named exterior branches or lights can be disabled for rendering. Worlds and EarthWorld are excluded from that list. This leaves the geometry intact while avoiding exterior overdraw and light contamination inside a nested scene. Visibility is not an animation-stop claim: many exterior clocks continue advancing. `?isolate=0` is an ablation switch, not a separate silently substituted scene.

## The ribbon failure: why context is part of geometry

The original build crashed before a usable frame on the available Chromium/SwiftShader rig. Reducing multisampling and removing text, routes or the broad shader set did not establish a working complete scene. A simple box did. The isolated head facets rendered; adding a shader-expanded ribbon reproduced the failure. Blocking MikkTSpace loading allowed the full baseline to render, with an expected fetch error. That diagnostic was not shipped.

Four IndexedFaceSet meshes contain a total of 3,605 intentionally zero-area input quads: two repeated endpoints encode a ribbon that its vertex shader expands later. A normal tangent generator sees degenerate surface geometry. The production fix gives those four meshes explicit neutral tangent bases orthogonal to their encoded normals. LineShader does not consume those tangents. Automatic tangent construction is bypassed for those meshes while ordinary physically shaded geometry keeps its normal path.

The production bird then rendered without blocking a dependency. This is evidence for the fix on this pinned rig, not proof of a universal X_ITE defect or universal driver behaviour. The source XML remains available, and the geometry witness compares Coordinate values, face indices and colour arrays exactly.

Explicit Tangent nodes require the experimental X3D 4.1 Rendering level 5 path in this runtime. The generated host declares that requirement. The bundle already used experimental GaussianSplats in the Pantheon. Pretending the result were strictly portable X3D 4.0 would undo the value of the repair.

**Practical rule:** reject an unexplained degenerate surface; require a declared interpretation and renderer witness for an intentional shader-expanded primitive. A blanket “delete degenerate faces” repair would have destroyed the luminous ribbon design.

## Lighting, materials and art direction

The keeper becomes an illuminated cabinet: cream typography, brass line drawings, a dark editorial frame and four recognisable destination cards. The cards are original code-drawn schematics, not simulated screenshots or documentary evidence. They collapse inside a world to return space to the scene. Story captions identify Giza’s speculative additions, the Pantheon’s sampled appearance and the Drillfield’s Google imagery attribution.

The host facet material gains a deterministic analytic studio environment with a warm key, cool opposite fill and broad overhead light. Six roughness levels are convolved using GGX importance sampling with N=V, N·L weighting and 96 Hammersley samples per level. The 256 × 780 RGBM8 atlas contains one-pixel gutters; roughness levels are decoded before interpolation. A periodic brushed-height texture adds restrained surface variation. Glints and flashes are reduced, not removed.

This is an authored, view-aligned studio reflection rig. It is not a reflection of the live scene, a path-traced material, or an energy-conserving rewrite of the complete artistic shader. The original colour, burn and glow language remains. RGBM is quantised, within-level bilinear filtering is approximate, and the finite quadrature has error. The maximum measured encode/decode error for the sharpest level is about 0.0069 in linear radiance units; the other levels are lower. Constant-environment preservation and finite-output tests exercise the baker independently.

The first roughness implementation used ordinary mip filtering of an RGBM image. That was superseded by the explicit prefiltered atlas: mip filtering encoded HDR values is a weak foundation for a material claim. The retained version names its actual convolution and limits.

Three literal reversed-edge `smoothstep` calls were found across FacetShader and LineShader. GLSL does not define that edge order. They are rewritten as one minus an ascending-edge smoothstep, preserving the intended descending curve. A mutation control restores the bad ordering and proves the semantic witness catches it.

Giza keeps its impossible disco. Its limestone key becomes warmer, its ambient fill cooler and quieter, and the animated palette moves away from aggressive green/magenta toward amber, muted cyan and violet. The beam cones illustrate an easy art/engineering trap: twelve individually transparent layers can combine into an almost opaque mass. Per-cone transparency is now 0.965, with a softer halo and less dominant lasers. These remain transparent geometric beams, not physically simulated participating media. Existing material-world shadow lights and supplied texture maps are retained.

## Cinematography and sound

The seven chapters move from keeper to heart, Giza, Pantheon, materials, Drillfield and return. Each has a clear arrival and dwell rather than an endless, context-free orbit. A small 2.5% push-in and slight field-of-view change provide motion during the dwell; the existing multiscale flight mechanism handles large distance ratios. Camera guards reject non-finite positions and choose a stable alternate up axis when look and up become parallel. Manual interaction, Escape and hidden-page transitions stop a directed journey. Reduced camera motion produces still arrivals; it is not a claim that every scene animation is disabled.

The supplied music remains silent until requested. Volume is adjustable. Each world receives a restrained three-note sine motif on arrival, with explicit envelopes and node disconnection. Heart oscillators and noise voices now disconnect on completion; a delayed loop scheduler skips stale scheduling history rather than trying to replay a long backlog. The heart mix uses the transformed sun position.

FFmpeg measured the supplied village bed at −26.20 LUFS integrated / −14.25 dBTP, and cosmos at −26.10 LUFS / −15.79 dBTP. These are input measurements, not new mastering or proof that a mixed browser output cannot clip. `evidence/audio.json` records file hashes and the exact measurement output. No human listening session or music-generation origin was reconstructed. An independent listening pass on the user's playback system remains useful, especially for the existing defect tick and loop transitions.

## Transport and performance: precise claims

The server binds localhost, serves the entire package offline, and negotiates gzip for textual assets. Its cache is bounded to 40 compressed entries, though that is an entry bound rather than a byte limit. Already compressed `.gz` host/graph files are not double encoded. Tests exercise compression, byte-for-byte decompression, gzip refusal and missing files.

| Asset | Uncompressed source | Served gzip bytes | Interpretation |
|---|---:|---:|---|
| Pantheon X3D | 6,542,952 | 2,408,844 | 63.2% fewer transferred bytes, same XML after decompression |
| Sphinx mesh XML | 7,311,564 | 2,100,285 | 71.3% fewer transferred bytes, same geometry text |
| X_ITE runtime | 1,306,526 | 282,046 | 78.4% fewer transferred bytes |
| Graph base64 → binary gzip | 354,120 → 265,588 | 265,588 | Removes base64 text and its decode allocation |

These are measured representation sizes, not measured loading-time improvements. If the old base64 text is itself served with HTTP gzip, most of its wire-size penalty disappears. Therefore “binary gzip is 25% faster” would be an unjustified claim. The remaining benefit includes a simpler decoding path and fewer transient representations. The new lighting textures and font also have a cost; they are not hidden from the candidate manifest.

No splats were quantised and no Sphinx triangles were simplified. Binary splat/mesh conversion remains a future option that needs its own geometric, colour, angular and image witnesses. Compression was the safe improvement available without claiming fidelity from an untested codec.

The profiler attaches to X_ITE's completed display hooks, not `getCurrentTime()` or DOM animation callbacks. CPU submission and optional disjoint GPU queries have separate columns. Pending and unavailable GPU measurements remain null. Four outstanding queries bound the instrumentation itself; epochs prevent old queries from contaminating a reset. A profile becomes invalid when navigation, exposure/resolution settings, viewport or visibility change. Fewer than 30 draw intervals is explicitly insufficient for a comparison.

The available rig is SwiftShader. Its measured frame intervals are slow and sparse, so this run does **not** certify 24/30/60 fps on an NVIDIA or AMD GPU. `evidence/browser.json` carries the exact current run, sample counts and rendering settings. Use the local Studio controls and exported receipt to measure the intended hardware. A graphics budget is a contract with a specified rig, not a slogan attached to a screenshot.

## Witnesses, gates and receipts

| Gate | Witness and control | What it establishes | What it does not establish |
|---|---|---|---|
| G-ID / current bytes | SHA-256 mismatch mutant; fetched XML versus build receipt | Receipt refers to this scene | Conformance or beauty |
| G-USE / references | Added field on USE mutant; experimental-header check | Reuse nodes retain reference-only attributes and no stale 4.0 schema hint | Full standards validation |
| G-DEF / names | Duplicate DEF scan | Named-node uniqueness in this host | Complete X3D semantics |
| G-GLSL / ordered edges | Literal reversed smoothstep mutant | Known undefined edge-order trap absent | Proof for every dynamic expression |
| G-HANIM / vocabulary | Legacy wrist-name mutant | Known 2.0 alias trap repaired | Full anatomical correctness |
| G-RIBBON / interpretation | Explicit basis removal; original crash isolation; production render | Intentional expanded ribbons have a declared tangent path | Universal GPU portability |
| G-DENSITY / preservation | Deleted-shape mutant; exact coordinate/index/colour comparison | No host geometry simplification was hidden | Identical pixels after relighting |
| G-OWN / load ownership | Reintroduced load ROUTE mutant | Controller is sole root Inline load writer | Ownership of every future nested asset |
| G-RES / residency | Budget, active-world pin, hysteresis, failure and retry controls | At most two controlled groups; recoverable failure | VRAM byte bound or cache reclamation |
| G-ARRIVAL / observation | Stale completion and delayed camera-observation controls | An old observer cannot undo new intent | Camera collision-free travel through arbitrary worlds |
| G-RADIANCE / bake | Constant field, finite samples, RGBM overflow and decode tests | Declared numerical bake behaves within tested limits | Physical truth of the whole stylized material |
| G-PROFILE / instrument | Unavailable/disjoint/epoch/budget controls and live setting mutation | Measurement scope and missing data remain honest | Discrete-GPU frame-rate certification |
| G-HTTP / delivery | Gzip roundtrip, refusal and no-double-encoding tests | Served bytes reconstruct their source | Fast networking on another deployment |
| G-EYES / picture | Actual frames inspected at keeper and four destinations | Missing worlds, UI obstruction and palette defects can be flagged | A scalar aesthetic grade |
| G-AUDIO / lifecycle | Gesture state, live decode, bounded voices, file loudness analysis | Specific audio mechanics and source levels | Human preference or perceptual sync at the speaker |
| G-PATCH / reproduction | Clean apply and resulting file-hash comparison | Patch reconstructs the delivered tree | Upstream merge approval |

`tools/audit.py` runs the deterministic suites. `tools/release.py` hashes the complete executable runtime file set, not just the scene, and rejects changed or added runtime files. Browser evidence records that candidate hash. Package checksums cover the final ZIP and patches separately, avoiding self-referential hashes. Each witness has a scope; no single green row grants every other row.

## What failed, and what that taught us

1. **The stale green badge survived a changed scene.** A claim needs a content key, scope and instrument version. A historical success is reference evidence until rebound and rerun.
2. **A generic geometry expectation misread a shader primitive.** The fix belongs at the representation boundary, not in a destructive mesh cleanup.
3. **The first adapter used `LoadSensor.watchList`.** The pinned X_ITE path uses `children`. The scene loaded, but the readiness witness waited until timeout. API field membership itself deserves a control; assigning a property is not evidence it is an active X3D field.
4. **The first budget controller could evict the visible world.** Protect current visibility and destination intent separately, then commit on arrival.
5. **A successful flight was undone by a delayed camera observation.** Event order is not world order. Generation tokens prevent stale loads; an arrival acknowledgement is separately needed for stale observers.
6. **A “ready” image briefly showed only sky.** The image witness exposed a lifecycle problem that structural and loading checks alone missed. Eye review must be downstream of real frames and must feed diagnosis rather than merely assign a score.
7. **Transparent beams accumulated into opaque colour.** Judge the composite, not a material parameter in isolation. Twelve layers change the design mathematics.
8. **An eight-second profile could contain only a handful of frames.** Duration is not sample size. Sparse data stays in the receipt, but it cannot silently pass as a useful comparison.
9. **The first audio cleanup assertion counted the wrong voices.** It expected all synthesis to be silent while the heartbeat was intentionally running. Separate motif-voice telemetry made the test specific enough to distinguish a leak from intended activity. A witness can be the defective component.
10. **A vocabulary repair added attributes to USE nodes.** Runtime rendering tolerated it, but the XML contract did not. The repair now touches only named joint declarations; reference-node hygiene and stale-schema-hint checks are independent witnesses.
11. **A prefetch grace period accidentally became a load timeout.** The failure-recovery test retried a slow world; the first controller evicted it after 15 seconds. Grace now starts from a ready world’s departure, while loading has its own readiness timeout and budget-pressure cancellation. Different clocks require different contracts.
12. **The image disagreed with the arrival label.** X_ITE’s bind-time camera transition was still active underneath the application flight. The navigation profile now uses TELEPORT for binding, the app owns the visible interpolation, old user offsets are reset explicitly, and “Arrived” waits for an observed pose within tolerance. Finite coordinates alone were too weak a camera witness.
13. **A renderer failure was sticky even after a load toggle.** The pure adapter tests passed, but X_ITE keeps FAILED_STATE until an explicit reset. Retrying a failed Inline now calls the pinned runtime’s loadNow() path; a real failed-request/recovery test verifies the boundary. Mock success cannot certify an adapter’s actual state machine.
14. **More physically motivated filtering did not make the entire shader physical.** Local mathematical improvements require local claims; the whole artistic model still has stylized Fresnel, burn and glow choices.

## Foldback into the global Loom

The portable patch is an addition-only proposal under `loom-feedback/gobbler-cabinet/`. It includes the residency/latch core, semantic predicates, profiler controls, numerical-bake controls and a promotion ledger. It intentionally includes no private Giza, music or imagery assets. The scene upgrade is a separate patch against the supplied archive.

Promote a rule in stages: preserve the minimal failure; specify the intended rejection and an allowed counterexample; run it on this project; run it against an unrelated corpus; measure false positives; then accept it into a global gate set. The new rules are **locally exercised candidates**, not globally calibrated laws. The ribbon rule, especially, must never become “all zero-area geometry is wrong.” The allowed counterexample is the point.

The broad practical wisdom is that the Loom becomes stronger when it turns a surprise into a smaller, more precise contract. Beauty suggests where to look. A witness tells you which claim can survive there. A receipt keeps that knowledge attached to the exact thing the user can run.

## Primary technical references

- X_ITE Inline: https://create3000.github.io/x_ite/components/networking/inline/ — unloading versus visibility, nested formats.
- X_ITE Tangent: https://create3000.github.io/x_ite/components/rendering/tangent/ — experimental Rendering level 5 / X3D 4.1 requirement.
- X_ITE IndexedFaceSet: https://create3000.github.io/x_ite/components/geometry3d/indexedfaceset/ — explicit tangent field and mesh semantics.
- Bundled X_ITE 16.5.1 source was inspected for `MaximumFrameRate`, `LoadSensor.children`, display hooks and tangent generation. The actual pinned code takes precedence over a guessed API name.

No upstream repository was modified remotely or published. No aesthetic jury score, full XSD pass, listening verdict, collision proof, discrete-GPU benchmark or measured VRAM-reclamation claim is implied by this delivery.
