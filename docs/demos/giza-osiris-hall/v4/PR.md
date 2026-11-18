# Add Hawara narrative atlas and stable X3D interior views

The Giza Evidence Atlas lacked a separate Hawara narrative and simultaneous interior view bank. This adds v4 with seven provenance-aware narrative chapters, an explicitly artistic twelve-court X3D model and the requested “Jordi LaForge vision” control for one or three independently navigable views. Frozen v3 assets and geometry remain unchanged.

The runtime tracks camera resources across appearance changes, suppresses evidence-label leaks, cancels stale loads and supplies per-view reset, focus handling, partial-load status, mobile view budgeting and hidden-view pausing. Giza feeds follow the main baked-light/exposure state. Hawara gains shaded stone with authored study/raking/night lighting and water visibility.

A dedicated presentation core audits all16 inherited viewpoints, fits Hawara orthographic cameras to full bounds and replaces independent tour position/orientation interpolation with position-plus-attention tracking. Playback offers smooth, linear and cut modes, timeline scrubbing, deterministic layer/cutaway cues and hidden-tab pause. The default10m tour-camera offset is removed. Light presets crossfade baked colours, sky, fog and sun marker; this is presentation interpolation, not a physical solar/illumination simulation.

Validation: 57 automated tests pass, including the inherited38, new camera/interpolation/colour/lifecycle tests and generated-X3D/deployment checks. Source camera gaze error is below0.012°; Hawara frame tests cover viewport aspects0.4/1/2.4 and the deepest illustrative layout. The cumulative patch applies to clean base2d01579e33e919510242a8d64f5e97556c851c95. Browser/WebGL acceptance and new XSD certification remain outstanding due to environment restrictions. No GPU performance or rendered screenshot claim is made. A browser acceptance script and detailed review accompany the code.

No front-page card, prior scene/data bytes, archaeological claim or other demo changes.
