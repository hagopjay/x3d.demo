/* Public-source helpers: OSM Overpass lodges (ODbL), Wikipedia GeoSearch, sun position, great-circle to Giza. */
(function (global) {
  const GIZA = { lat: 29.97917, lon: 31.13417 }; // Great Pyramid, Wikipedia coordinates
  const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  function distance(a, b) { // haversine, metres
    const R = 6371008.8, dl = rad(b.lat - a.lat), dn = rad(b.lon - a.lon);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  // Low-precision solar position (NOAA / Meeus-style, ~0.01 deg class); returns azimuth (from north, clockwise) and altitude.
  function sun(date, lat, lon) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const g = rad((357.529 + 0.98560028 * d) % 360), q = (280.459 + 0.98564736 * d) % 360;
    const L = rad((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360), e = rad(23.439 - 0.00000036 * d);
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = rad(((18.697374558 + 24.06570982441908 * d) % 24) * 15), H = gmst + rad(lon) - ra;
    const alt = Math.asin(Math.sin(rad(lat)) * Math.sin(dec) + Math.cos(rad(lat)) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(rad(lat)) - Math.sin(rad(lat)) * Math.cos(H));
    return { az: (deg(az) + 360) % 360, alt: deg(alt) };
  }
  function query(lat, lon, r) {
    const a = `(around:${r},${lat},${lon})`;
    return `[out:json][timeout:25];(nwr["club"="freemasonry"]${a};nwr["fraternity"="freemasonry"]${a};nwr["building"]["name"~"Masonic|Freemason",i]${a};nwr["amenity"="community_centre"]["name"~"Masonic",i]${a};);out center tags 60;`;
  }
  async function overpass(lat, lon, r) {
    const key = 'lodges:' + lat.toFixed(2) + ':' + lon.toFixed(2) + ':' + r;
    try { const c = JSON.parse(localStorage.getItem(key)); if (c && Date.now() - c.t < 86400000) return c.v; } catch (e) {}
    let err;
    for (const u of ENDPOINTS) {
      try {
        const res = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(query(lat, lon, r)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!res.ok) throw new Error(u + ' ' + res.status);
        const j = await res.json(), seen = new Set(), out = [];
        for (const el of j.elements) {
          const c = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center; if (!c) continue;
          const id = el.type + '/' + el.id; if (seen.has(id)) continue; seen.add(id);
          const t = el.tags || {};
          out.push({ id, name: t.name || 'Masonic building (unnamed in OSM)', lat: c.lat, lon: c.lon, addr: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' '), src: 'OpenStreetMap ' + id });
        }
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: out })); } catch (e) {}
        return out;
      } catch (e) { err = e; }
    }
    throw err;
  }
  async function wikiNear(lat, lon) { // free, CORS via origin=*; one result near the lodge
    const u = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=1000&gslimit=3&format=json&origin=*`;
    const j = await (await fetch(u)).json();
    return (j.query && j.query.geosearch || []).map(x => ({ title: x.title, dist: Math.round(x.dist) }));
  }
  function fixture(lat, lon) { // synthetic test points around the given position; NOT real lodges
    const off = [[0.0016, 0.0000], [-0.0008, 0.0021], [0.0011, -0.0024], [-0.0019, -0.0009]];
    return off.map((o, i) => ({ id: 'fixture/' + (i + 1), name: 'Fixture lodge ' + (i + 1) + ' (test point, not a real building)', lat: lat + o[0], lon: lon + o[1], addr: '', src: 'synthetic test fixture' }));
  }
  global.Lodges = { GIZA, distance, bearing, sun, overpass, wikiNear, fixture, query };
})(window);
