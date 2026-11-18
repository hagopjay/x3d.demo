# Notice: BodyParts3D meshes in medical-provenance v5

`scene/bp3d-overlay.x3dz` contains **derived meshes of BodyParts3D** (The Database Center for Life Science, Japan): the 99 percent polygon-reduced PART-OF OBJ release, merged per FMA class, **decimated by vertex clustering and transformed (scaled, rotated, moved) by us** into the CT frame. Changes were made. The original zip (65 MB, sha256 `9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97`) is not in this repository.

**Licence texts disagree (read 18 Nov 2026):**
- Every OBJ file header: "Creative Commons Attribution-Share Alike 2.1 Japan", attribution "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan".
- The current licence page http://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html (updated 2025/02/27): "Creative Commons Attribution 4.0 International", attribution "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International".

Until that is clarified with DBCLS, treat the shipped meshes **as CC BY-SA 2.1 Japan** (the stricter reading): the derived mesh file `scene/bp3d-overlay.x3dz` is offered under those terms, with the attribution above. The rest of this folder (page, builder, metrics) is separate work. If the repository owner prefers not to ship share-alike material, delete that one file and the overlay toggle; the metrics and builder remain. This is not legal advice.

Other sources as in `../v3/NOTICE.md`. Educational proof of concept, not medical advice.
