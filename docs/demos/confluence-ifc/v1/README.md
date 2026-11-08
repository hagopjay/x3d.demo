# Confluence: IFC ↔ X3D live model studio (read-only copy)

A gallery building whose every element keeps its IFC identity, drawn in X3D by X_ITE 16.5.1 with baked lighting and its own shaders. 111 identified products, 23 shared meshes. Use the camera shots, the atmospheres (daylight, nocturne, study), the element search and the inspector; **Cinema view** hides the panels.

**What is different from the live studio.** The studio is a transactional bridge: a Python server (IfcOpenShell) owns the IFC model and sends each committed revision over a WebSocket, and edits made in any browser go back through it. GitHub Pages can only serve files, so this copy replays one recorded revision instead:
- `snapshot/snapshot.json` is the server's revision-0 message, recorded from the running studio, with its scene URL pointed at `snapshot/scene-0.x3d`. The scene is byte-identical to the server's (sha256 59b11f25afb18d70…), and the page still checks every hash in the receipt before drawing.
- `snapshot/model.ifc` is the IFC model behind it; its sha256 matches the receipt's source hash.
- Patched in `app/main.js`: `connect()` loads the snapshot instead of opening the WebSocket; paths are relative (the scene's absolute shader and texture paths are rewritten in memory, after its hash is checked); no bootstrap token. `app/style.css`: the font path is relative. Nothing else changed.

Editing (move, rename, review status), peer views and live IFC commits need the server and do nothing here. Run the full studio from the source: `python3 studio/serve.py` (see the original README).
