// node build/gltf_validate.mjs FILE.gltf LOOM_PATH -> {tool, errors, warnings, infos, messages[]} from the Khronos glTF validator
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [file, loom] = process.argv.slice(2);
const require = createRequire(loom + '/x3d.gltf/package.json');
const validator = require('gltf-validator');
const r = await validator.validateBytes(new Uint8Array(readFileSync(file)), { uri: file, maxIssues: 50 });
console.log(JSON.stringify({ tool: `Khronos glTF-Validator ${r.validatorVersion}`, errors: r.issues.numErrors, warnings: r.issues.numWarnings,
  infos: r.issues.numInfos, messages: r.issues.messages.filter(m => m.severity <= 1).slice(0, 8).map(m => ({ code: m.code, pointer: m.pointer, severity: m.severity })) }));
