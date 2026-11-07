# Chirp: debrief, pass 1 (4 Nov 2026)

The fourth x3d.STEM flagship, built with the X3D Loom. Grades: **C** = a named tool ran and showed it; **L** = read or reasoned; **S** = suspected or a visual judgement. Every witness number is in [NUMBERS](NUMBERS.html), generated from the case manifests.

## 1. What it is

Two black holes spiral together, and you hear them. The relative orbit is integrated with Newtonian gravity plus the leading radiation-reaction force (Damour–Deruelle, 2.5PN). The orbit shrinks *because* it radiates; no chirp formula is drawn. The run stops at r = 6 M, where this model stops being fair.

- **30 + 30 suns**, like LIGO's first detection: 34.3 orbits in 3.74 s, the wave rising from 12 Hz to about 72 Hz.
- **48 + 12 suns**: the light hole races round the heavy one; 53.6 orbits in 5.84 s.
- **Eccentric orbit** (e = 0.6 at 40 M): the waves round the orbit off to e ≈ 0.08 and it sings in bursts at each close pass.

The page draws the holes at their true horizon size, their trails, and the wave pattern in the orbital plane. The pattern is computed in the browser from the verified quadrupole samples with the far-field formula at the retarded time t − R, so the spiral arms lag the source as they should. **Watch** runs in slow motion through the scene's TimeSensor. **Hear** plays the verified audio in real time, with the picture drawn at the audio's own clock: the real-pitch strain (a deep rumble, best on headphones), or a sonification three octaves up with the same timing.

## 2. Witnesses (C)

36 in all, every one green on the final build. Limits were declared in `tools/chirp.py` before the first build.

- **Integration.** The orbital energy lost equals the work done by the radiation-reaction force to 4 × 10⁻¹¹. Halving the tolerance changes the orbit count by 2 × 10⁻⁹.
- **Exact references** (orbit averages while the separation is above 10 M):
  - Peters' decay a(t) = (a₀⁴ − 256/5 η t)^¼ to 1 × 10⁻⁴;
  - the Newtonian chirp law Ω ∝ τ^(−3/8) to 3.4 × 10⁻⁴;
  - Kepler's third law to 3.9 × 10⁻⁴;
  - Peters' exact a(e) relation for the eccentric orbit to 2.8 × 10⁻⁴, with e falling on every orbit;
  - the quadrupole luminosity against the energy actually removed, to 1.5 × 10⁻⁴ (circular) and 3.5 × 10⁻⁴ (eccentric).
- **Waves.** The strain crosses zero four times per orbit (frequency twice the orbital) to within 0.006.
- **Ear.** In every window, each audio track crosses zero exactly as often as the strain's phase advance says, within one crossing at the window edges. A negative control must fail: the three-octave track resampled 2 % fast misses by 6.5 to 24 crossings. There is no clipping.
- **Display.** Linear interpolation between the published samples (192 per orbit) departs from the dense solution by at most 1.3 × 10⁻³.
- **In the browser (Chromium, Apple M3, muted).**
  - Wave heights at 36 reference points per inspiral match the builder to 2 × 10⁻¹⁵.
  - Slow-motion playback advances through the TimeSensor.
  - Both audio tracks play to the end, with the picture within 1.5 ms of the sound.

## 3. What failed, and what it taught

1. **The Ear witness compared unlike things, twice (C).** The first version compared a pitch counted over a 100 ms window with the instantaneous wave frequency at the window centre. An eccentric orbit sweeps its frequency within every orbit, so they disagreed by 31 %. The second divided crossings by the span between the first and last crossing, not by the window: 11 %. The audio was right both times. The witness is now stated exactly: by construction h₊ = A cos Φ, so the audio must cross zero ΔΦ/π times in any window. It comes with a negative control that must fail. Both red runs are in `evidence/history/`.
2. **128 samples per orbit were not enough at close passes (C).** Interpolation error reached 3.04 × 10⁻³ against a 3 × 10⁻³ limit in the eccentric case. Now 192.
3. **Picture and sound drifted 0.8 to 1.5 s apart (C).** The audio starts after decoding, and X_ITE's frame clock can lag wall time, so a TimeSensor started alongside the audio ran ahead. The browser evidence caught it only once it compared the two clocks. In Hear mode the sound is the clock now.
4. **A frequency came out negative and emptied a witness (C).** The strain's phase runs backwards with the chosen sign convention. The witness then had nothing above 20 Hz to check and crashed rather than passing: fail-closed did its job.

## 4. Limits (also in every case manifest)

- **The model:** Newtonian orbits plus the leading radiation reaction; no conservative post-Newtonian terms and no spins.
- **No merger or ringdown.** These, the loudest part of a real signal, are not modelled, so the sound ends where the model ends.
- **The wave surface:** the far-field formula is used even inside a wavelength, so the near zone (inside 12 M) is not drawn. Heights are exaggerated, with the fall-off softened to 1/√R.
- **The three-octave track** is a sonification, not the signal.
- **The browser run was muted:** it verified clocks and playback, not what a listener hears.

## 5. Next pass

- Merger and ringdown from a published numerical-relativity waveform (licence permitting), joined to this inspiral and checked against it where they overlap.
- Spins and precession: the orbital plane wobbles and the chirp is modulated.
- A dome master (Theatre lens) with spatial audio, the planned museum piece.
- A LIGO-noise version: hear how faint the real signal is, and watch matched filtering pull it out.
