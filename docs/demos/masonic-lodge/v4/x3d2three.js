/* Minimal X3D -> THREE subset loader for AR.js (Masonic Lodge XR v3). The scene stays X3D; this only draws it in AR.
   v3 reads what x3d-blender-io writes for a baked scene: Transform, Group, Billboard, Shape, Appearance with Material or
   UnlitMaterial (emissiveTexture ImageTexture: the baked light), IndexedFaceSet with Coordinate and TextureCoordinate
   (texCoordIndex, or coordIndex when it is absent), Box, and DEF/USE. Textures resolve relative to `base`. */
(function (global) {
  function nums(s) { return (s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number); }
  function load(xmlText, THREE, base) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('X3D parse error');
    const root = new THREE.Group(), defs = {}, loader = new THREE.TextureLoader(), texCache = {};
    const resolve = (el) => { const u = el && el.getAttribute('USE'); return u ? defs[u] : el; };
    const remember = (el) => { const d = el && el.getAttribute('DEF'); if (d) defs[d] = el; return el; };
    function texture(el) {
      el = resolve(el);
      if (!el) return null;
      remember(el);
      const url = (el.getAttribute('url') || '').match(/"([^"]+)"/);
      if (!url) return null;
      const key = new URL(url[1], base).href;
      if (!texCache[key]) {
        const t = loader.load(key);
        if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding;
        t.flipY = true;
        t.userData.alpha = /\.png$/i.test(key);
        texCache[key] = t;
      }
      return texCache[key];
    }
    function mat(shape) {
      let app = resolve(shape.querySelector(':scope > Appearance'));
      remember(app);
      const um = app && resolve(app.querySelector(':scope > UnlitMaterial'));
      if (um) {
        remember(um);
        const map = texture(um.querySelector(':scope > ImageTexture'));
        const e = nums(um.getAttribute('emissiveColor') || '1 1 1');
        const tr = parseFloat(um.getAttribute('transparency') || '0');
        return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(e[0], e[1], e[2]), transparent: tr > 0 || !!(map && map.userData.alpha),
          opacity: 1 - tr, side: THREE.DoubleSide, alphaTest: 0.02 });
      }
      const m = app && resolve(app.querySelector(':scope > Material'));
      const d = nums(m && m.getAttribute('diffuseColor') || '0.8 0.8 0.8');
      const e = nums(m && m.getAttribute('emissiveColor') || '0 0 0');
      const tr = parseFloat(m && m.getAttribute('transparency') || '0');
      return new THREE.MeshLambertMaterial({ color: new THREE.Color(d[0], d[1], d[2]), emissive: new THREE.Color(e[0], e[1], e[2]),
        transparent: tr > 0, opacity: 1 - tr, side: THREE.DoubleSide, map: texture(app && app.querySelector(':scope > ImageTexture')) });
    }
    function geom(shape) {
      const box = shape.querySelector(':scope > Box');
      if (box) { const s = nums(box.getAttribute('size') || '2 2 2'); return new THREE.BoxGeometry(s[0], s[1], s[2]); }
      const ifs = resolve(shape.querySelector(':scope > IndexedFaceSet'));
      if (!ifs) return null;
      remember(ifs);
      const pts = nums(resolve(ifs.querySelector(':scope > Coordinate')).getAttribute('point'));
      const tcEl = ifs.querySelector(':scope > TextureCoordinate');
      const tc = tcEl ? nums(resolve(tcEl).getAttribute('point')) : null;
      const ci = nums(ifs.getAttribute('coordIndex'));
      const ti = ifs.hasAttribute('texCoordIndex') ? nums(ifs.getAttribute('texCoordIndex')) : ci;
      const pos = [], uv = [];
      let poly = [];
      for (let k = 0; k <= ci.length; k++) {
        const i = k < ci.length ? ci[k] : -1;
        if (i < 0) {
          for (let n = 1; n + 1 < poly.length; n++) for (const [p, t] of [poly[0], poly[n], poly[n + 1]]) {
            pos.push(pts[3 * p], pts[3 * p + 1], pts[3 * p + 2]);
            if (tc) uv.push(tc[2 * t], tc[2 * t + 1]);
          }
          poly = [];
        } else poly.push([i, ti[k]]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (tc) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    }
    function walk(el, parent) {
      for (const c of el.children) {
        if (c.tagName === 'Transform' || c.tagName === 'Group' || c.tagName === 'Billboard') {
          const g = new THREE.Group(); g.name = c.getAttribute('DEF') || '';
          if (c.tagName === 'Transform') {
            const t = nums(c.getAttribute('translation') || '0 0 0'), r = nums(c.getAttribute('rotation') || '0 0 1 0'), s = nums(c.getAttribute('scale') || '1 1 1');
            g.position.set(t[0], t[1], t[2]); g.scale.set(s[0], s[1], s[2]);
            if (r[3]) g.quaternion.setFromAxisAngle(new THREE.Vector3(r[0], r[1], r[2]).normalize(), r[3]);
          }
          if (c.tagName === 'Billboard') g.userData.billboard = true;
          parent.add(g); walk(c, g);
        } else if (c.tagName === 'Shape') {
          const geo = geom(c); if (geo) { const m = new THREE.Mesh(geo, mat(c)); parent.add(m); }
        }
      }
    }
    walk(doc.querySelector('Scene'), root);
    // Billboards face the camera each frame (AR.js renders with three's camera)
    root.traverse((o) => {
      if (o.isMesh && o.parent && o.parent.userData.billboard) o.onBeforeRender = (r, s, cam) => cam.getWorldQuaternion(o.parent.quaternion);
    });
    return root;
  }
  global.X3D2THREE = { load };
})(window);
