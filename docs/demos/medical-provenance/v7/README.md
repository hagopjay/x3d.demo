# medical-provenance v7: an open pancreas label as an FMA-linked segment

The v6 CT series with the NIH pancreas label added as segment 5 (FMA:7198 Pancreas) of a `SegmentedVolumeData`. Nine graded claims (4 C, 3 L, 2 S). Educational proof of concept, not medical advice.

- `index.html`: 3D (pancreas only or all segments), axial slice scrubber with the label in green, the table of the 8 axis flips that were tried, claims, hash check, receipt.
- `scene/ct-organ.x3d` uses the hash-checked `../v6/scene/ct-intensity.nrrd` and `scene/ct-organ-labels.nrrd` (gzip u8, ids 0 to 5). One MetadataSet holds the series, label file, zip hash, annotator statement, axis fix and segment term.
- `build.py`: `python3 -I build.py --gate <x3d_mcp>/src` (numpy, pydicom, nibabel). Needs v6 built, the DICOM zip (v6 cache or NBIA) and downloads the 1 MB label zip into `data/cache/` (git-ignored). Asserts that the v6 volumes and DICOM pixels match their pinned hashes.

Not tested: GPU browsers, other browsers, other patients' labels, registration to the v3 torso. See `NOTICE-TCIA.md`.
