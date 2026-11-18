/* Minimal X3D -> THREE subset loader (Transform, Group, Shape, Appearance/Material,
   Box, IndexedFaceSet/Coordinate). Enough for giza-lodge.x3d. Scene stays X3D; this only draws it in AR.js. */
(function (global) {
  function nums(s) { return (s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number); }
  function load(xmlText, THREE) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('X3D parse error');
    const root = new THREE.Group();
    function mat(shape) {
      const m = shape.querySelector(':scope > Appearance > Material');
      const d = nums(m && m.getAttribute('diffuseColor') || '0.8 0.8 0.8');
      const e = nums(m && m.getAttribute('emissiveColor') || '0 0 0');
      const tr = parseFloat(m && m.getAttribute('transparency') || '0');
      return new THREE.MeshLambertMaterial({ color: new THREE.Color(d[0], d[1], d[2]),
        emissive: new THREE.Color(e[0], e[1], e[2]), transparent: tr > 0, opacity: 1 - tr, side: THREE.DoubleSide });
    }
    function geom(shape) {
      const box = shape.querySelector(':scope > Box');
      if (box) { const s = nums(box.getAttribute('size') || '2 2 2'); return new THREE.BoxGeometry(s[0], s[1], s[2]); }
      const ifs = shape.querySelector(':scope > IndexedFaceSet');
      if (ifs) {
        const pts = nums(ifs.querySelector('Coordinate').getAttribute('point'));
        const idx = nums(ifs.getAttribute('coordIndex')), tri = [];
        let poly = [];
        for (const i of idx) { if (i < 0) { for (let k = 1; k + 1 < poly.length; k++) tri.push(poly[0], poly[k], poly[k + 1]); poly = []; } else poly.push(i); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        g.setIndex(tri); g.computeVertexNormals(); return g;
      }
      return null;
    }
    function walk(el, parent) {
      for (const c of el.children) {
        if (c.tagName === 'Transform' || c.tagName === 'Group') {
          const g = new THREE.Group(); g.name = c.getAttribute('DEF') || '';
          if (c.tagName === 'Transform') {
            const t = nums(c.getAttribute('translation') || '0 0 0'), r = nums(c.getAttribute('rotation') || '0 0 1 0');
            g.position.set(t[0], t[1], t[2]);
            if (r[3]) g.quaternion.setFromAxisAngle(new THREE.Vector3(r[0], r[1], r[2]).normalize(), r[3]);
          }
          parent.add(g); walk(c, g);
        } else if (c.tagName === 'Shape') {
          const geo = geom(c); if (geo) { const m = new THREE.Mesh(geo, mat(c)); parent.add(m); }
        }
      }
    }
    walk(doc.querySelector('Scene'), root);
    return root;
  }
  global.X3D2THREE = { load };
})(window);
