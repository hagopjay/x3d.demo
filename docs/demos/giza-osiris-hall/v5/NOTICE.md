# Giza V · Earth's Tesla Coil · interpretation and provenance

This v5 proof of concept extends the Giza v4 chamber journey into an imagined planetary circuit. It retains the ankh and Was-sceptre, switchable Witness/First-person cameras, reduced-motion behavior, and staged craft/nonhuman encounter. A sky crown, standing-looking arcs, a schematic Nile-region network, and an inspectable storage/supply model add the Earth's Tesla Coil premise. This is a software and art prototype, not a discovery announcement or a surveyed archaeological reconstruction.

## Evidence and imagination

The interface and `evidence.json` distinguish four tiers:

| Tier | Meaning in this edition |
| --- | --- |
| `documented` | A bounded statement supported by the linked historical, archaeological, or technical source. It does not certify every associated visual detail. |
| `model` | A result or analogy under stated assumptions. A published theoretical model and this prototype's teaching model remain separate models. |
| `hypothesis` | A proposed mechanism or configuration whose presence or operation at Giza has not been established here. |
| `fiction` | An invented figure, device, event, effect, or story premise. |

The 2018 electromagnetic paper studies response to **external** radio waves. Its resonant field concentration does not demonstrate generation of energy. This application does not implement that paper's solver or claim its quantitative results.

The large underground quartz deposit, continuous conductive metal lining, precise electrical material ratios, functional ankh, and journey apparatus are proposed scenario elements. The consulted sources do not establish them as an ancient Giza installation. A hypothetical 100,000 blocks of two metric tonnes each means 200 million kg in a load scenario, not the actual monument's mass. Dielectric behavior and piezoelectric coupling are different physical properties. Static weight does not continuously produce electrical power; sustained extraction requires continuing energy input.

Wardenclyffe's documented wireless ambitions inspire comparison. This edition supplies no evidence that Tesla was replicating Giza. Alien authorship and physical consciousness transfer remain fictional possibilities within the story, not alternative archaeological findings demonstrated by the rendering. Ancient Egyptian builders and the documentary record of their work remain part of the historical context.

The selected devices are an **ankh and a Was-sceptre**. The Was is historically associated with dominion or power; that symbolic meaning does not establish electrical technology. The exact pose, placement, materials, luminous coupling, and narrative functions of both objects are invented. Symbols represented by much later museum objects are not evidence for those objects' presence in Khufu's chamber. The king's figure, sarcophagus presentation, chamber decoration, imagined conductors, quartz geometry, and journey choreography are artist-designed schematic elements.

The accepted story deliberately escalates through cosmic geometry, ancient machines and craft, and a nonhuman encounter. The maximum stage is selectable; the default permits all three. These are authored cinematic fiction, including where the story presents its machines as ancient. Switching between Witness and First-person cameras changes the viewer's relationship to the same fictional event. Hiding the figure in first-person view avoids self-occlusion; it does not represent a tested consciousness-transfer mechanism. Reduced motion freezes automatic camera travel while leaving the timeline and evidence accessible.

## Atmospheric and regional interpretation

Two international miles is **3.218688 km**, within the troposphere. The low mythic canopy is therefore called a **storm canopy**, not the ionosphere. NASA gives a lower ionospheric extent of roughly 48–50 km and describes a variable region; the prototype's **80 km** reference is a chosen sheet within that context. The sky-height control spans 3.218688–300 km, mapped into an explicitly compressed vertical drawing. Apparent mesh and arc distances are not to scale.

The real global atmospheric circuit includes a roughly **250 kV** ionospheric potential maintained by thunderstorms and electrified shower clouds, with very small fair-weather current density. That context does not establish a locally available gigawatt source. The mythic preset's MW/GW supply is an entered assumption. The reference preset retains assumed local components and bench-source values; it is not a measured Giza configuration.

The luminous arcs, planetary coil, regional links, and Upper Egypt beacons are authored visualizations. The map is schematic rather than GIS or a historical power-grid reconstruction. Arc paths are not solved plasma channels, and their apparent continuity is not proof of a self-sustaining atmospheric discharge. No hardware construction, voltage-clearance design, or lightning-harvesting procedure is specified here.

## Models and quantities

The inherited RF workbench uses a **single-degree-of-freedom driven oscillator** to explain detuning, damping, and relative response. It is not a full-wave electromagnetic calculation. Its amplitude and scene colors are relative values rather than calibrated volts per metre, tesla, or watts. The inherited RC/piezo analogy is dimensionless; it demonstrates a changing-force input and charge leakage, without predicting a site-scale electrical output.

The new `tesla.mjs` model uses separately dimensioned lumped LC and reservoir quantities. The µF reservoir capacitance is distinct from the pF secondary capacitance; inductance is entered in mH and drive frequency in kHz. Entered MV and MW/GW values convert consistently to SI; stored energy is reported in J/GJ. Capacitance, energy, and power are different quantities. Its reservoir capacity follows **E = ½CV²**; source, delivered output, losses, and initial precharge require a balanced ledger. It does not measure pyramid capacitance, collect atmospheric energy, or compute a global transmission network. The dimensionless inherited models do not automatically charge the new SI reservoir.

The mythic default is explicitly initialized full at **12.5 GJ** from **10 µF** and **50 MV**. A hypothetical **600 MW** source, **1 GW** arc demand at **0.6 duty**, and **5 MW** loss are authored scenario values. The precharge is initial energy, not energy discovered in the pyramid. Run/Hold, Reset, and Precharge are numerical experiment controls separate from story playback. The source card treats “dielectricity” as material response, not an energy-bearing fluid.

Visible pulses, a voyage timeline, and optional audio operate at human-perceptible rates. They are presentation channels, not literal animation of a megahertz field. Artistic material settings are not measured frequency-dependent permittivity, conductivity, loss tangent, or piezoelectric tensors. A bright line is not a solved current path, and water animation is not a hydraulic or hydrogeological simulation.

The local coordinate frame and metre-like architectural proportions are modelling conventions. Internal passages and chambers are simplified for legibility. Stars and celestial geometry are artistic and carry no precession or alignment accuracy claim. v3's astronomical dataset and validation receipts do not automatically apply to this scene.

## Dependencies and credits

The application loads the repository's existing **X_ITE 16.6.0** from `../v3/vendor/`. Its third-party licensing remains in the bundled dependency, including `../v3/vendor/x_ite/LICENSE.md` where present. Preserve that directory and its notices when distributing a runnable package.

The project-level repository licence, where supplied, governs the repository's own new material. This notice does not relicense third-party software or source publications. v3's original notices remain authoritative for v3 assets; this edition does not extend their asset-specific licences to unrelated new assets. Source articles, museum records, and associated media retain their respective authorship and rights. This edition links the sources and paraphrases their relevant conclusions; it does not claim their endorsement.

## Versions and distribution

New sessions use `giza-tesla/1`, retain the inherited journey/laboratory settings, and add the `tesla` object. Earlier `giza-horizon/1` and `/2` settings migrate with the planetary circuit disabled. A session restores assumptions rather than silently claiming a previously charged physical reservoir.

The portable deliverable is `Giza-V-Earths-Tesla-Coil.zip`. It must preserve the v5 directory and sibling v3 renderer assets with their licence notices. v4 can be retained for comparison but is not an engine dependency.

## Validation boundaries

The new generated scene needs its own structural, numerical, and browser checks, including the new reservoir ledger and units, atmospheric labels, presets, scene controls, and regional display, as well as inherited midjourney camera switching, first-person self-occlusion, encounter caps, and reduced-motion behavior. Existing v3 XSD, semantic, star-catalogue, and bake receipts certify only their stated inputs. A well-formed XML result is not an X3D schema or semantic validation receipt. A screenshot or successful render is not physical validation. `SPECIFICATION.md` labels acceptance criteria as targets until actual check results are recorded; this notice claims no browser verification of v5. The environment's blocked browser verification remains a limitation until a real render and interaction session is observed.
