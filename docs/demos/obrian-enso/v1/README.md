# Demo 86 · OBrian: the 2026 El Niño as plain X3D (obrian-enso/v1)

Real NOAA ocean, SST and wind data for the tropical Pacific as one X3D 4.0 file per event, drawn by X_ITE 16.7.1: a `VolumeData` anomaly volume to 300 m, the 20 °C thermocline surface, an equatorial section, an SST map, wind-anomaly arrows and the Niño 3.4 box, animated month by month by `TimeSensor` to `IntegerSequencer` to `Switch` ROUTEs. Events: 2026 (now), 1997-98, 2015-16 and the 2010-11 La Niña. Source, builder and receipts: https://github.com/hagopjay/x3d.STEM (`studies/obrian/v1/`). This folder is the hosted copy (`build/publish.py`).

OBrian is the codename for ocean and weather visualisation, in memory of James J. O'Brien (1935-2016), Florida State University, founder of COAPS (name and dates as published by COAPS; not affiliated with or endorsed by FSU, COAPS or his family).

## Receipts (28 Nov 2026; each names its tool)

| check | result | instrument |
|---|---|---|
| Oct 2026 Niño 3.4 anomaly | +3.02 °C (ERSST v5, base 2001-2020) and +3.25 °C (CPC OISST); highest monthly value in both records. CPC's 3-month ONI (Aug-Oct +2.46) is not yet above Dec 2015 (+2.59) | `build/build_data.py`, numpy 2.5.3, xarray 2026.9.0, CPython 3.13.18 |
| thermocline tilt (20 °C depth, W box minus E box) | 7.4 m Oct 2026; -2.0 m Dec 1997; 66.3 m Dec 2015; 170.8 m Dec 2010 La Niña; normal about 133 m | same, NCEP GODAS |
| cross-check | ERSST vs CPC OISST r 0.987, RMS 0.153 °C (538 months); 3-month vs ONI r 0.975, RMS 0.27 °C (920 months) | same |
| schema and semantic | 4 Blender mesh scenes: 0 schema errors, 0 semantic errors. 4 page scenes: only `containerField='transferFunction'` refused by the 4.0 XSD (10 of 10 volumes in 2026), which X_ITE 16.7.1 needs; upstream report held until December | x3d_mcp `validate_xml` and `semantic_diagnostics`, `receipts/validate.json` |
| page witnesses | recompute from the scene on screen, one control that must fail; see the page | in-page JS, X_ITE 16.7.1 |
| Blender stills | x3d-blender-io 2.9.0 import, Cycles CPU, 1600x900, 48 spp, about 110-120 s a still | bpy 5.3.0 |

Limits: monthly means of an assimilation product and a reconstruction; 2026 months are near-real-time and may be revised; anomalies use 2001-2020 (not CPC's moving base); winds end Feb 2026; vertical scale about x5,550; X_ITE tested on software GL only (no frame rate claimed); not a forecast.

Serve over http to run locally: `python3 serve.py`.
