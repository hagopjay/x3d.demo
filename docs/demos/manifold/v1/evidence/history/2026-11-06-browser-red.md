# Red browser run, 6 Nov (browser-2026-11-05.json, the machine's local date)

Passed: X3D health, field parity, playback, ripple, fidelity in all four moods (SSIM 0.906 to 0.960, mean
Delta E 1.47 to 2.15; mirror control 0.513 and later-moment control 0.554 failed as they must).

Red 1, callback_resilience: frames_after 20, limit "> 20". The frame count over 1.5 s measures the headless
software renderer's rate (about 13 fps), not resilience; the field's time (0.971 of 0.975 expected) and the X3D
clock (1.494 s of 1.5 s) kept advancing after the throw, which is what the probe is for. Cause: the instrument.
Fix: require that frames, the field's time (at least 80 % of the expected advance) and the clock (at least 1.3 s)
go on, with no frame-count threshold.

Red 2, saved_moment: SSIM 0.736 against the live frame. A real defect. The saved X3D, loaded alone, has no
BlendMode (the page adds it at run time), and every light layer wrote alpha 1, so under standard alpha
blending the veil sheet and the ribbons were opaque. Any X3D browser would have drawn the file that way.
Fix: the light layers write (g / max(g), max(g)), which under standard SRC_ALPHA / ONE_MINUS_SRC_ALPHA
blending gives g + d (1 - max g): the screen blend exactly for grey light and nearly for coloured light.
No X_ITE extension is needed any more; BlendMode is dropped.

## Second run (standard alpha): fidelity red on luma

Saved moment 0.9987 (fixed); resilience passed. Fidelity: Catharsis luma 2.27 % against the 2 % limit (Reverie
1.36 %, Euphoria 1.84 %, Stillness 0.88 %; SSIM 0.907 to 0.970, all within limits). Cause: the standard-alpha
output (g / max g, max g) gives g + d (1 - max g), which subtracts d (max g - g_k) from every channel that is
not the brightest: coloured light over a bright surface comes out darker, most in the most saturated mood.
Fix, in the renderer: output colour mix(g / max g, 1, mu) with mu = 0.3, the typical surface value under the
light layers (the same centre tools/blend_fit.py weights). The error becomes (d - mu)(g_k - max g): zero on
average, still exact for grey light. Grade L (it assumes the typical d).

## Third run (unbiased light colour): fidelity red on Catharsis luma only

Reverie 1.08 %, Euphoria 1.13 %, Stillness 0.63 %, Catharsis 2.09 % (limit 2 %); every SSIM and Delta E within
limits; saved moment 0.9987. One cause at a time on Catharsis: with the analytic occlusion off its luma falls to
0.80 % (Delta E 2.27 -> 2.19). The occlusion is this page's own addition (the original's screen-space AO darkens
this view by under 0.1 %), and its strength 0.25 was chosen on Reverie: the worst case, the deepest basins of
Catharsis, was not explored first (Loom law 28). Fix: strength 0.12, so the added crease shading stays inside
the declared look budget in the worst mood; the limit is unchanged.
