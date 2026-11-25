# Demo 79 · Salon of Two Centuries, v2: the Western Epic wings (salon-two-centuries/v2)

v1 (art 1700-1899 as a walkable corridor, **1 m = 1 year**) is untouched and still live next door. v2 keeps every v1 room
and adds a good slice of the owner's [Western.Epic.md](https://github.com/hagopjay/gcloud.map/blob/main/Western.Epic.md):
its **Enlightenment & Romantic 1750-1900** branch (ELIT, EPHIL, EMUSIC, ARCH_19) as four new wings on the same time axis,
so a novel, a treatise, a string quartet and a railway station of the same year stand side by side with the paintings.

| layer | what it is | data |
|---|---|---|
| v1 corridor | spine, 9 movement galleries, 57 public-domain paintings at real size, 3 walk-ins, pigment tower | v1 folder, shared not copied (`../../v1/paintings/`) |
| **Wings** (new) | Letters and Ideas on the left, Music and Building on the right, one lane further out than the galleries. Each person is a life rail from birth to death year; each work a plaque at its year | `data/people.json`: 190 lives (letters 60, ideas 45, music 45, building 40) of 771 harvested; 130 works |
| **Listening posts** (new) | 12 score excerpts, 1711 to 1851, each an X3D `Sound` + `AudioClip` that starts when you walk into its post (`ProximitySensor` enterTime → startTime) | `audio/` mp3, `audio/manifest.json` |
| **Iron and glass** (new) | the Crystal Palace (1851) at 1:18 and the Eiffel Tower (1889) at 1:20, built from primitives at their years | own models, proportions from published dimensions, not survey data |
| **Atlas sky v2** (D) | v1's painter threads plus the new lives; 75 cross-field arcs in magenta (a writer influenced by a philosopher, a composer by a poet) | 211 links (197 influenced by, 14 student of) |
| **The Epic's named people** | the chart names 33 people for this branch; 32 were found and shown, Montesquieu was not (the harvest's occupation filter missed him) | page table "Named in the Epic" |

## Receipts (25 Nov 2026)

| check | result | instrument |
|---|---|---|
| data | 771 people harvested, 190 shown (top by sitelinks per field), 351 places, 211 links (75 cross-field), 130 works | QLever Wikidata endpoint, `build/ql.py` + `build/curate_v2.py` |
| audio | 12 excerpts, 30-40 s each, 4.6 MB: score notes from the music21 corpus, played by an additive synth with a short reverb, encoded mp3 80 kb/s | music21, numpy, ffmpeg, `build/synth.py` |
| XSD + semantic | X3D 4.0 valid, 0 errors, 0 warnings, 244 info | x3d_mcp fork `4d433af`, `assets/validate-receipt.json` |
| round trip | 54/54 wall paintings (Wikidata id + year) equal; 3/3 walk-in rooms; 56 ImageTexture urls, 0 missing | lxml, `build/validate.py` |
| load + frames | ready in ~36.5 s; 20 frames at 2x, 0 black; the only console lines (2) are the page's own fetch of the frame receipt before it existed | X_ITE 16.7.1, Chromium 158 (Playwright), SwiftShader WebGL2, `shots/shots-receipt.json` |
| picking | fly-to + card for *The Oath of the Horatii*: asked Q476458, card shows it | `build/shots.mjs` |
| speed | software GL went from 0.34 to 0.56 frames/s after binning labels and works into distance LODs (20 m per bin) and merging each wing's rails into one IndexedFaceSet | SwiftShader, so a relative number only, not a performance claim |

The page needs only WebGL2. Sound starts muted; the **Sound** button turns it on.

## Known gaps (graded)

- Montesquieu is missing (Confirmed). Some Wikidata dates are odd (Likely): *Deutschlandlied* is dated 1841 (the lyric) under Haydn, and the Statue of Liberty is credited to Viollet-le-Duc (its first engineer) because that is what Wikidata holds.
- The Crystal Palace and Eiffel models are proportioned sketches, not measured models (Confirmed).
- The excerpts are synthesised from the notes, not performances; dynamics and ornaments are simplified (Confirmed).
- Not yet tested on a real GPU (Confirmed).

## Rebuild

```
python3 -I build/curate_v2.py            # needs raw/ from build/ql.py queries -> data/people.json
python build/synth.py audio              # music21 corpus -> audio/*.mp3 + manifest.json
python3 -I build/build_x3d.py            # -> assets/salon.x3d (reads v1 paintings and depth)
python3 build/validate.py /path/to/x3d_mcp
node build/shots.mjs http://127.0.0.1:8765/demos/salon-two-centuries/v2/ OUT 2
```

## Learned here (folded into x3d.loom)

1. **QLever handles a cross-field harvest in one pass.** Four occupation families, life dates, places, influence and teaching links, and works through three different authorship properties (P50 author, P86 composer, P84 architect) came back without a single 429.
2. **Public-domain scores make lawful sound.** Notes from the music21 corpus, synthesised here, avoid recording rights entirely; the encodings keep their own terms (see DATA-ATTRIBUTION.md).
3. **X3D Sound with a ProximitySensor gives "walk in to listen"** with two ROUTEs and no script.
4. **Long time-rooms need distance LODs.** 200 m of labels at once halved the frame rate in software GL; bins of 20 m with LOD fixed it.
5. **Element screenshots crop when the element is partly off screen.** Clip the page screenshot to the element's box after scrolling it into view.
6. **Text rotated to face the visitor can come out mirrored**; check plaques from the visitor's side in frames, not in the code.
7. **Share assets across versions, don't copy them.** v2 references v1's paintings, so the 17 MB is stored once and v1 stays untouched.
