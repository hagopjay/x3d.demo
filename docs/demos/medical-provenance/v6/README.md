# medical-provenance v6: open DICOM CT as X3D VolumeData

One open TCIA series (Pancreas-CT, CC BY 3.0) turned into X3D `VolumeData` and `SegmentedVolumeData`, with the provenance carried inside the scene and ten graded claims (5 C, 2 L, 3 S). Educational proof of concept, not medical advice.

- `index.html`: 3D volume (two scenes), axial slice scrubber decoded from the shipped arrays, claims table, WebCrypto hash check, receipt.
- `scene/ct-volume.x3d`: VolumeData + ImageTexture3D (`ct-intensity.nrrd`, gzip u8) + ComposedVolumeStyle (BoundaryEnhancement, ToneMapped). `scene/ct-segments.x3d`: SegmentedVolumeData with `ct-labels.nrrd` and one ShadedVolumeStyle per segment id. A single MetadataSet (first child of the Transform) holds source UID, DOI, licence, pixel-data sha256, processing factors, window, file hashes, segment terms.
- `claims.json` / `claims.jsonld`, `data/findings.json`, `data/summary.json`, `validation-v6.json` (x3d_mcp `validate_xml`, 0 errors both scenes).
- `build.py`: `python3 -I build.py --gate <x3d_mcp>/src` (numpy, pydicom). Downloads the series from the NBIA API into `data/cache/` (git-ignored). Rebuilds the NRRD files byte for byte (gzip mtime 0).

Axes: x = patient left, y = superior, z = anterior (right-handed). HU bands: gas/lung < -500, fat -500..-30, soft -30..250, dense >= 250 inside a flood-fill body mask. The bands are not an anatomical segmentation; the FMA terms offered are judgements (grade S). See `NOTICE-TCIA.md` for the data licence.

Not tested: GPU browsers (software GL only, the segmented scene draws slowly), other browsers, organ-level labels, registration to the v3 torso.
