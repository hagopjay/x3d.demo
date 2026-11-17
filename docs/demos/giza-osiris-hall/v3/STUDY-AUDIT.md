# Giza study evidence and model audit

Checked on 16 November 2026 against the supplied v2 files and a small set of reopened sources. This pass does not claim a new archaeological survey, a complete literature review, or a reopening of all 128 links in the original research record.

The strongest feature of the supplied study is its willingness to draw an idea while identifying it as an idea. The main improvement is to keep that distinction visible at the point of inspection: a documented subject, a schematic model, a computed sky, and an invented room can share a frame without acquiring the same evidential status.

## Three independent labels

| Question | Useful label | What the label does not establish |
| --- | --- | --- |
| What kind of archaeological proposition is this? | Documented, theorized, speculative, or mixed context | That every mesh or interpretation in the view is documented. |
| How was this geometry made? | Published dimensions, rounded-coordinate placement, schematic section, invented architecture | Survey precision or reconstruction fidelity merely because the subject is real. |
| What was done with a source? | Opened/read in the supplied research pass; selectively rechecked now; not rechecked | That the source's proposition is true, accepted, or independently replicated. |

In `content.json`, **Confirmed** is a legacy source-access/research grade. It is not a scientific probability or a badge that makes the proponent's claim true. The distinction is particularly important on Contested cards, whose claim and rebuttal share one card grade. A reader can have opened a source that describes a false or unverified claim.

The new `evidence-index.json` therefore carries a selected-topic tier, a separate `geometry_status`, limitations, existing card references, and source URLs. It does not overwrite the original card grades or claim that all their sources were re-read. A selected-view badge is contextual: free movement may reveal objects from several tiers simultaneously.

## What the available assets establish

A fresh count of the actual content gives 75 cards: 32 Technical, 21 Wonder, 22 Contested. Their recorded grades are 33 Confirmed, 41 Likely and one Suspected. There are 128 distinct source URLs; the supplied data marks 125 as opened. Those flags belong to the original pass.

The star asset contains **978 field stars and 40 named stars**. The original NOTICE and sky prose say 41 named stars, an off-by-one count. The asset and `NAMED` list in `build/stars_build.py` agree on 40. There are 152 epoch samples from astronomical year −13000 through +2100.

The original `validation.json` describes a 2,456,501-byte scene with hash prefix `877aff00acd5`. Its XSD, semantic and profile verdict is a receipt for that input. It must be preserved as a baseline receipt after a generated scene changes. New structural, numerical and render checks should identify their own source hash and say which validator, if any, actually ran.

## Selected source checks

### The Osiris Shaft and depth quantities

[Hawass 2007, hosted through Harvard Digital Giza](https://giza.fas.harvard.edu/pubdocs/476/full/) provides the excavation publication and [PDF](https://d1g9lvwdq3dcse.cloudfront.net/images/MFA-images/Giza/GizaImage/full/library/hawass_fs_oconnor.pdf). The inspected architectural descriptions give shaft drops of 9.62, 13.25 and 7.50 m, and Chamber B as 6.80 × 3.65 × 2.60 m. Figure 2 uses a ground datum and shows the deeper section label 35.45 m.

The arithmetic sum **30.37 m** describes shaft drops. It should not be presented as a competing estimate of the same datum as **35.45 m**. The useful experiment is a comparison of definitions and reference levels. The original model also admits that its underground plan offsets, chamber orientation, equal side-chamber boxes and some heights are illustrative. Published dimensions do not turn those choices into a surveyed reconstruction.

### Two different muon findings

The 2017 [Big Void paper](https://doi.org/10.1038/nature24647), with an [open author version](https://arxiv.org/abs/1711.01576), reports a minimum 30 m extent above the Grand Gallery. Its detection does not determine intended purpose or contents.

The 2023 [North Face Corridor paper](https://doi.org/10.1038/s41467-023-36351-0) concerns a separate feature. Its abstract describes about 9 m length and a cross-section near 2 × 2 m. The [Egypt State Information Service announcement](https://sis.gov.eg/en/media-center/news/tourism-min-unveils-discovery-of-new-corridor-inside-khufu-pyramid/) reports approximately 9 m by 2.1 m. These findings support careful labels for distinct structures, not a general inference of a Hall beneath the plateau. Publisher/PMC text retrieval was intermittent; this check does not claim every detailed figure or uncertainty was reanalysed.

### The Khafre “648 m” visualization

[Reported archaeological authority statements](https://english.ahram.org.eg/newscontentp/9/543433/antiquities/no-discoveries-were-made-beneath-pyramid-of-khafre.aspx) reject the claim; that report is not a new subsurface survey.

The official [MDPI retraction notice](https://www.mdpi.com/2072-4292/18/16/2679), dated 10 August 2026, attributes withdrawal of the 2022 **Khufu** radar article to methodological flaws and statistical errors; it records the authors' disagreement. The notice does not announce a misconduct finding. It concerns a different publication from the later Khafre presentation and does not itself constitute a field test of its proposed shafts.

The model should therefore say **unverified claim illustrated to scale**, with its invented radii, spiral pitches and cube positions explicitly retained as modeling assumptions. “Documented controversy” and “documented underground structure” are different propositions. The measured comparative ruler does not grant equal evidential support to all quantities placed beside it.

## Consequential presentation corrections

| Existing presentation | Better interpretation or label |
| --- | --- |
| “Confirmed” beside a Contested card | Source/research grade from the supplied pass; display the claim's tier separately. |
| Osiris depth ruler “disputed totals” | Shaft-drop sum and section datum; name both references. Keep genuinely unsourced totals distinct. |
| “Equinox sunrise” light bake | Illustrative equinox morning: its fixed sun elevation is +7°, not a computed sunrise instant. |
| Sidereal-hour preset “dawn” at 18 h | A fixed LST orientation. Dawn requires a solar/date/observer model and a stated horizon definition. |
| Historical year labels | Astronomical year 0 is 1 BCE, and year −10500 is 10501 BCE. State the convention consistently. |
| Precession clock prose suggesting any sky is exactly reversible | A precession-only model with an explicit catalogue, interpolation policy and omissions. Proper motion and refraction matter in some contexts. |
| Nearest-pole star described as “brightest nearest” | The nearest-to-pole member of this finite named-star subset; no brightness optimization is performed by the original code. |
| Photoreal or cinematic Hall detail | Authored visualization of a narrative. More detail does not add archaeological evidence. |
| Underground transparent shells | A diagrammatic inspection mode; geometry transparency does not indicate a real excavation face. |
| Modern coordinate offsets called precise ground truth | Rounded published-coordinate placement in a local metre frame. Avoid a survey-accuracy claim. |

The original `fmtYear` deliberately rounded the BCE convention by a year. A technical instrument should instead format the astronomical year correctly, even when its physical sky model has much larger uncertainty. Precision of notation and precision of the underlying model are separate issues.

## Model boundaries to keep visible

- **Hall of Records:** the dimensions, 26 m depth, placement, columns, niches, dais, orb and lighting are invented. No reconstructed masonry surface or excavated plan is supplied.
- **Seismic anomaly:** the displayed box represents an interpretation; its thickness and exact placement are authored. A signal or anomaly does not by itself identify a chamber, a connecting tunnel or a Hall.
- **Khufu interior:** the model combines published lengths and discoveries with schematic positions. The Big Void box is not a complete reconstruction of an inspected room.
- **Orion comparison:** sky geometry, a mapping between three stars and three pyramids, and ancient design intent are distinct. A visual resemblance under chosen orientation is not a statistical test or an independent construction date.
- **Catalogue:** nearby field-star selection is not a naked-eye completeness model. Named-star omissions limit the “nearest pole star” comparison.
- **Lighting:** three baked vertex-colour states and one authored night tone are supplied. They are not a continuously recomputed solar ephemeris or dynamic global illumination.

## Recommended learning progression

1. Start with the measured Osiris components, a visible datum and a ruler. Predict which depth quantity a label measures before selecting it.
2. Move from a published dimension to its model position. Identify what is measured, rounded, schematic, or invented.
3. Compare documented shaft drops, section depth and the unverified 648 m claim on one scale. Explain why equal units do not imply equal evidence.
4. Inspect the sky at fixed epoch and varying LST, then fixed LST and varying epoch. Explain what each changes and which effects remain absent.
5. Enter the invented Hall with its label still visible. Distinguish artistic plausibility from an archaeological reconstruction.
6. Export a session with the selected topic, camera, layers, sky settings, source/model limitations and exact input hashes. This is a reproducibility witness, not an authenticated historical discovery.

## Scope of the index

`evidence-index.json` currently covers the 16 camera views generated during this enhancement, including the new Survey, DepthCompare, HallDetail and Section views. It contains six selectively checked source records. Its legacy card and URL references come from `content.json`; their inclusion does not claim a new reading of all 128 URLs.

The index's source and notice digests identify the snapshots used to build it. Generated tour or edition-notice files may subsequently change during integration; retain the meaning of those fields as snapshots rather than treating them as a new immutable manifest. Runtime validation should hash the final files separately.
