// node build/gltf_validate_file.mjs LOOM_GLTF_DIR FILE... : Khronos glTF-Validator counts per file, as JSON
import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs'; import { join } from 'node:path';
const v = createRequire(join(process.argv[2], 'x'))('gltf-validator'); const out = { validator: 'Khronos glTF-Validator ' + v.version(), files: {} };
for (const f of process.argv.slice(3)) { const r = await v.validateBytes(new Uint8Array(readFileSync(f)));
  out.files[f.split('/').pop()] = { errors: r.issues.numErrors, warnings: r.issues.numWarnings, infos: r.issues.numInfos, hints: r.issues.numHints, codes: [...new Set(r.issues.messages.map(m => m.code))] }; }
console.log(JSON.stringify(out));
