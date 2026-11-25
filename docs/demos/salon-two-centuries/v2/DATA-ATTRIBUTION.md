# Demo 79 (salon-two-centuries/v2): sources, attribution and takedown

v2 adds the wings below to v1. Everything credited in [v1's DATA-ATTRIBUTION.md](../v1/DATA-ATTRIBUTION.md) (57 paintings, depth maps,
movements, pigments, renderer) still applies; the paintings are loaded from the v1 folder, not copied.
The scene, page, build scripts, models, synthesised audio and derived data in this folder are this project's own work (CC BY 4.0).
Naming a source below is credit, not a claim of ownership or endorsement. This page is not legal advice.

| what | source | owner / author | licence or terms | status |
|---|---|---|---|---|
| the branch chosen and its named people (33) | [hagopjay/gcloud.map Western.Epic.md](https://github.com/hagopjay/gcloud.map/blob/main/Western.Epic.md), branch "Enlightenment & Romantic 1750-1900" | HagopJay, the project owner | the owner's own work | 32 of 33 found; Montesquieu missing |
| people, life dates, places, influence and teaching links, works and their dates | [Wikidata](https://www.wikidata.org/) via the [QLever](https://qlever.dev/wikidata) SPARQL endpoint (University of Freiburg), queried 25 Nov 2026 | Wikidata contributors | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `data/people.json` (190 of 771 people, 130 works, 211 links) |
| score encodings for the 12 excerpts | the [music21](https://github.com/cuthbertLab/music21) corpus (table below) | music21 by Michael Scott Asato Cuthbert and contributors (software BSD-3-Clause); each encoding by its encoder | the corpus licence says encodings are distributed with the encoders' permission and that **some may not be used commercially**; this demo is non-commercial | Likely fine for this use; the compositions themselves are public domain (composers died 1750-1901) |
| the 12 audio excerpts | synthesised here from those notes (additive synth, reverb, ffmpeg mp3) | this project | own work | no recordings by anyone else are used |
| Crystal Palace (1:18) and Eiffel Tower (1:20) | built here from X3D primitives; proportions from widely published dimensions | this project | own work | sketches, not measured models; no photographs or plans copied |
| renderer | X_ITE 16.7.1 (vendored in Demo 56) | create3000 / Holger Seelig | GPL-3.0, notice in the vendor folder | not modified |

## The excerpts

| year | piece | composer | encoding | file |
|---|---|---|---|---|
| 1711 | Lascia ch'io pianga (Rinaldo) | George Frideric Handel | music21 corpus file `handel/rinaldo/Lascia_chio_pianga.mxl` | `audio/handel-lascia.mp3` |
| 1722 | Prelude in C major, BWV 846 (Well-Tempered Clavier I) | Johann Sebastian Bach | music21 corpus file `bach/bwv846.mxl` | `audio/bach-bwv846.mp3` |
| 1762 | String Quartet Op. 1 No. 1, i. Presto | Joseph Haydn | music21 corpus file `haydn/opus1no1/movement1.mxl` | `audio/haydn-op1no1.mp3` |
| 1784 | String Quartet K. 458 'The Hunt', i | Wolfgang Amadeus Mozart | music21 corpus file `mozart/k458/movement1.mxl` | `audio/mozart-k458.mp3` |
| 1788 | Piano Sonata K. 545, i (exposition) | Wolfgang Amadeus Mozart | music21 corpus file `mozart/k545/movement1_exposition.mxl` | `audio/mozart-k545.mp3` |
| 1793 | String Quartet Op. 74 No. 1, i | Joseph Haydn | music21 corpus file `haydn/opus74no1/movement1.mxl` | `audio/haydn-op74no1.mp3` |
| 1800 | String Quartet Op. 18 No. 1, i | Ludwig van Beethoven | music21 corpus file `beethoven/opus18no1/movement1.mxl` | `audio/beethoven-op18no1.mp3` |
| 1806 | String Quartet Op. 59 No. 1 'Razumovsky', i | Ludwig van Beethoven | music21 corpus file `beethoven/opus59no1/movement1.mxl` | `audio/beethoven-op59no1.mp3` |
| 1825 | String Quartet Op. 132 | Ludwig van Beethoven | music21 corpus file `beethoven/opus132.mxl` | `audio/beethoven-op132.mp3` |
| 1827 | Der Lindenbaum (Winterreise) | Franz Schubert | music21 corpus file `schubert/Lindenbaum.xml` | `audio/schubert-lindenbaum.mp3` |
| 1830 | Mazurka Op. 6 No. 2 | Frederic Chopin | music21 corpus file `chopin/mazurka06-2.krn` | `audio/chopin-mazurka.mp3` |
| 1851 | La donna e mobile (Rigoletto) | Giuseppe Verdi | music21 corpus file `verdi/laDonnaEMobile.mxl` | `audio/verdi-donna.mp3` |

Encoders named in the files themselves (where present): MuseScore exports (Handel, Bach with source musescore.com/score/117279, Verdi);
Craig Stuart Sapp / KernScores, CCARH (Chopin Op. 6 No. 2, Humdrum); Luke Poeppel (Mozart K. 458; its rights field reads only "Copyright ©" with no holder named); Schubert's *Der Lindenbaum* is a Sibelius export; the rest name no encoder in the file.

## Takedown, and how to ask

If you own anything listed here (an encoding, a data record, a credit) and want it removed or the credit changed, open an issue at
https://github.com/hagopjay/x3d.demo/issues titled `Takedown: salon-two-centuries` and say what you want removed.
It will be removed promptly after a request, without argument; the history can be cleaned on request.
Each excerpt is one mp3 and one row in `audio/manifest.json`; each person or work is one row in `data/people.json`, so removal is a small change.
