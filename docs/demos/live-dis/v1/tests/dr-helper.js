// dr-helper.js: runs ../src/dis-dr.js and ../src/dis-geo.js on cases given as JSON on stdin, for the Python
// cross-check. Writes JSON on stdout.
//   node dr-helper.js deadreckon   input: { cases: [state + dt] }               output: { cases: [{ location, orientation }] }
//   node dr-helper.js geo          input: { cases: [{ lat, lon, h, heading, pitch, roll }] }
import { deadReckon } from '../src/dis-dr.js';
import { geodeticToEcef, ecefToGeodetic, LocalFrame } from '../src/dis-geo.js';

let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
const mode = process.argv[2];
const cases = input.cases.map((c) => {
  if (mode === 'deadreckon') { const r = deadReckon(c, c.dt); return { location: r.location, orientation: r.orientation }; }
  if (mode === 'geo') {
    const ecef = geodeticToEcef(c.lat, c.lon, c.h);
    const frame = new LocalFrame(c.lat, c.lon, c.h);
    return { ecef, geodetic: ecefToGeodetic(ecef), euler: frame.eulerFromNedAttitude(c.heading, c.pitch, c.roll) };
  }
  throw new Error('mode must be deadreckon or geo');
});
process.stdout.write(JSON.stringify({ cases }));
