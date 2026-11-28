// Loads the vendored Ammo (Bullet, zlib licence) build in Node for the physics tests.
const path = require('path');
module.exports = function loadAmmo() {
  const dir = path.resolve(__dirname, '..', 'vendor', 'ammo');
  const factory = require(path.join(dir, 'ammo.wasm.js'));
  return factory({ locateFile: (file) => path.join(dir, file) });
};
