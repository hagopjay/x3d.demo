# Notice: licences and credits

Which folder carries which licence, and who must be credited. The leak sweep and the Truth witness read this file; a source missing here fails the build.

## By folder

| Path | Licence | Why |
|---|---|---|
| Code: `witnesses/`, `gen/`, `page/`, `audio/` (scripts and the Faust programs in `audio/faust/`), `score/` (scripts), `tools/`, `blender/`, `tracks/` (scripts), `.github/` | MIT (`LICENSE`) | Our own code |
| `sources/sonata11-3.krn` | CC BY-NC-SA 4.0 | Unmodified copy of the Humdrum encoding credited below |
| `score/turca.score.json`, `tracks/turca.*`, and every audio, frame and film derived from the *Alla Turca* score card | CC BY-NC-SA 4.0 | Adapted from the encoding credited below; share-alike applies to adaptations |
| `sources/ode-theme.musicxml`, `score/ode.score.json`, `tracks/ode.*` | MIT for the encoding; the melody is public domain | The theme is Beethoven's (1824), encoded by hand from the public-domain tradition |
| Audio made from the Ode card (`build/audio/ode/`, nothing sampled) | MIT; the melody is public domain | Synthesised in code from our own encoding |
| Audio made from the Turca card | CC BY-NC-SA 4.0 (the row above), and the piano's credit below travels with it | The piano is a recorded instrument; every other voice is synthesised |
| `art/` (the generated pictures the worlds can use, and `art/manifest.json`) | CC BY 4.0, as a default | AI-made, rebuilt from their pixels alone (see "AI-made material" below). The licence is the owner's to change; the default asks for credit and nothing else |
| `docs/` | MIT | Our own text |

Commercial use of anything derived from the *Alla Turca* score card needs a fresh hand encoding of the 1878 edition (public domain) that does not use the file credited below. That is listed as longer-term work, not done.

## Credits

**Mozart, Piano Sonata in A major, K. 331 (300i), third movement, *Alla Turca*** (1783). The composition and the Alte Mozart-Ausgabe (Breitkopf & Härtel, 1878) are in the public domain. The digital encoding used here is:

> Digital edition of Mozart piano sonatas, from volume 20 of the Alte Mozart-Ausgabe (1878).
> Copyright (C) 2004-2018 Craig Stuart Sapp. https://github.com/craigsapp/mozart-piano-sonatas
> File `kern/sonata11-3.krn`, commit `0f1f49d`, licensed CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0).

Changes made: the file is parsed to note events with exact rational onsets and durations, repeats are expanded following the file's own repeat plan, and an arrangement layer (drums, bass, pads, brass, percussion) is added around the written notes. The written notes themselves are not altered.

**Beethoven, Symphony No. 9 in D minor, Op. 125, finale** (first performed 1824). Public domain. Text of *An die Freude* by Friedrich Schiller (1785), public domain.

**Salamander Grand Piano V3**, by Alexander Holm (a Yamaha C5 recorded at 48 kHz, 24 bit), remapped to SFZ and FLAC by kinwie: https://github.com/sfzinstruments/SalamanderGrandPiano. Licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
> Used: 17 keys (D#2 to D#6) at 8 of the 16 velocity layers, 136 FLAC files, 212 MB. Each file's size and sha256 are in `sources/salamander.manifest.json`; `tools/fetch_salamander.py` fetches and checks them, and nothing of the recordings is committed.
> Changes made: a note takes the nearest recorded key and is shifted by resampling by at most one semitone, the two layers either side of its velocity are blended, the start is trimmed to where the level first passes minus 50 dB under the recording's peak, and a release is added when the key goes up. The result is mixed with synthesised instruments, so what is heard is AI-made audio, not a recording of anyone playing the piece.
> The credit is in the metadata of every master file and on the listening page.

## Samples and tools

Listed as they are added. A sample library is named here with its licence and the commit or hash it was taken at before any audio made from it is published.

| Item | Use | Licence |
|---|---|---|
| X_ITE 16.5.1 | The X3D browser, shipped as the page's own files | MIT |
| music21 10.5.2 | The Score witness's second parser (not used by the builders, not shipped) | BSD-3-Clause |
| pedalboard 0.9.26 | Effects and the master chain (P2) | GPL-3.0 (its package metadata). Installed from PyPI, never vendored or shipped here |
| DawDreamer 0.9.0, with the Faust compiler | Plays the Faust voices (P2) | GPL-3.0 (its package metadata). Installed from PyPI, never vendored or shipped here |
| pyloudnorm 0.2.0, soundfile 0.14.0, soxr 1.1.0, scipy 1.18.1, librosa 1.0.0 | Loudness, files, resampling, filters, analysis (P2) | MIT, BSD-3-Clause, LGPL-2.1-or-later, BSD-3-Clause, ISC (package metadata) |
| x3d_mcp validator (fork) | Grammar and Meaning witnesses | Web3D Consortium Open-Source License |
| `loom_gate.py`, `loom_receipt.py` | Traps and Receipts witnesses | as published by their repository |
| Playwright 1.63.0, Chrome for Testing 153 | Behaviour, Host, Eyes, Sync and Fps witnesses and the P0 probes; test tools, not shipped | Apache-2.0 (Playwright); the browser's own notices |
| ffmpeg 6.1.1 | Encodes the AAC `.mp4` and `.mp3` listening copies and the audio probe files, re-encodes the animated cards for the page, and gives the Ear witness its second loudness and true-peak reading; an external tool, not shipped | per its build (the Ubuntu 6.1.1 build is configured with `--enable-gpl`) |
| pytest, numpy, lxml, jsonschema, xmlschema, rdflib, x3d | Witnesses and generators; not shipped | MIT or BSD, see each project |
| Pillow | Rebuilds the generated pictures from their pixels, weaves the Ode's tapestry from one, writes the posters; not shipped | MIT-CMU (HPND) |

Our own code is MIT and calls pedalboard and DawDreamer at run time; this repository contains none of their code. What a licence like the GPL says about the sound those programs help make is a question this file does not settle (the audio carries no part of their code).

## AI-made material

Pictures, video and voices made with generative tools are labelled AI-made wherever they appear: the corner note and the end credits of each piece, the cards around the pieces (the picture behind the title, each opening, the picture behind the end card), and the caption of every shared still. Prompts and the sha256 of each are in `docs/PROMPTS.md`; the private ledger that records what each call cost is not part of this repository.

| What | Where it is used | Kept here |
|---|---|---|
| The tapestry's picture | The Ode: a generated picture, fitted to the loom's five threads, so every cell of it is a thread laid for a real note (`gen/picture_ode.py`) | `art/ode-tapestry.png`, rebuilt from the generated picture's pixels alone: no metadata of the original is kept, and the file carries one comment of ours that says it is AI-made |
| The twelve tile motifs | The Turca's dome: one Iznik-style tile picture for each section, one for the hush before the first note and one for the final chord (`gen/shaders/dome_fs.glsl`) | `art/dome-motifs.jpg`, an atlas of twelve tiles, built the same way |
| The animated cards | A moving picture behind the title card and behind the end card, and an opening for each piece (`page/cards.js`) | Not kept here: they are video, over this repository's limit for media. `tools/prep_cards.py` makes them from the generated clips; a build without them is a page without cards |
| Backdrops | Not on the page yet: three generated clips of rooms are being rebuilt as splat worlds | Not kept here |

Every world builds and passes its witnesses without any of these: `art/manifest.json` has a switch for each picture (`LOOM_ART=procedural` builds the stand-ins drawn by code), and a picture whose file does not match the manifest is never used. A picture is an upgrade of the scenery and never part of the music, which is synthesised in code from the score cards.
