# The bounded sky model

The new `sky-math.js` module separates reproducible sky geometry from page controls. It uses the supplied star vectors and sampled precession matrices. It does not fetch a catalogue, calculate a solar ephemeris, or claim to reconstruct an ancient observation.

## Data actually inspected

`stars_v2.json` contains **978 field stars, 40 named stars, and 152 matrix samples** from astronomical year −13000 through 2100 in 100-year steps. The supplied notice's count of 41 named stars was off by one. Its source metadata attributes the matrix samples to ERFA `ltpb` and the long-term Vondrák model; this pass did not independently regenerate those samples from ERFA.

The build's original initial epoch is −10499, corresponding to **10500 BCE**. The old browser initial value was −10500, which is **10501 BCE** under astronomical year numbering. Historical labels use no year zero: astronomical 0 is 1 BCE, −1 is 2 BCE, and +1 is 1 CE.

## What changed mathematically

- The old runtime selected the nearest matrix sample, so the sky jumped when the epoch crossed a half-century boundary. The new model brackets the epoch and interpolates the orientation along the shortest quaternion arc.
- Supplied matrices are rounded to six decimal places. Each is first projected onto an orthonormal right-handed basis, with a strict near-rotation input check. This removes numerical shear; it does not improve the underlying catalogue or precession model.
- Exact sample epochs retain the supplied orientation within rounding-scale adjustments. Intermediate matrices are proper rotations rather than a linear blend of matrix coefficients.
- Out-of-range epochs explicitly clamp or reject. A receipt can report the requested year, effective year, bracketing samples, interpolation fraction, and whether clamping occurred.
- Unit vectors are normalized before extracting declination. Finite/range checks reject zero vectors and malformed matrices instead of producing hidden NaNs.
- Upper-meridian altitude is `90° − |latitude − declination|`, which also handles stars culminating north of the zenith. A negative result means even the upper culmination is below the geometric horizon.
- Rise/set solutions distinguish ordinary crossings, circumpolar stars, never-rising stars, and grazing cases. A nonexistent rise is returned as `null`, not a fabricated clamped hour angle.

No independent ERFA comparison at intermediate epochs was performed. Smooth interpolation is a rendering and numerical-geometry improvement, not a new accuracy certification.

## Coordinate and time contract

Inputs to the horizon conversion are an equatorial direction, **local sidereal time in hours**, and observer latitude in degrees. Outputs are altitude and north-clockwise azimuth in radians. X3D coordinates use **+X east, +Y up, −Z north**. Azimuth is explicitly undefined at zenith/nadir; the API supplies `azUndefined` and a finite display placeholder.

LST is a stellar orientation parameter. It is not the civil clock and cannot alone establish a date or a dawn time. A preset of LST 18 h can illustrate ideal geometric equinox sunrise under the assumptions of solar right ascension 0 h and a flat horizon. The page's independent baked-light selection does not compute the Sun for that epoch. A Sun elevation of +7° is an illustrative morning lighting state rather than the defined rise of the solar upper limb.

Rising calculations here are for a point source crossing the selected flat geometric horizon. Atmospheric refraction, terrain, observer-height dip, and a solar/lunar disk are not included. Proper motion, nutation, aberration, parallax, a solar ephemeris, UT1, and civil-time conversion are also omitted.

## A good invariant already present in v2

The original X3D scene already routes `CamSensor.position_changed` to `SkyRig.set_translation`. This keeps the astronomical sky centered on the moving observer and prevents the finite drawing radius from creating artificial stellar parallax. Preserve that route. Conceptual Orion-to-pyramid overlays remain world-space diagrams and must not be mistaken for distant stars.

Keeping the same local east/north frame while moving around the schematic plateau is another approximation. This module does not model transport over Earth's curved surface.

## Public API

`GizaSky` is available as a browser global and as CommonJS `require('./sky-math.js')`.

| API | Result |
| --- | --- |
| `formatYear(astronomicalYear)` | Rounded integer epoch labelled BCE/CE with the correct year-zero conversion. |
| `createModel(stars)` | Validated model with `minEpoch`, `maxEpoch`, `sampleCount`, and `matrixAt`. |
| `model.matrixAt(epoch, {outOfRange:'clamp'})` | `{matrix, requestedEpoch, epoch, lowerEpoch, upperEpoch, t, clamped, interpolated, nearestEpoch, method}`. Use `outOfRange:'error'` to refuse extrapolation. |
| `dated(vector, matrix)` | Normalized rotated direction. Extra catalogue fields after the first three vector components are ignored. |
| `equatorial(vector)` | `{ra, dec}` in radians, with RA in `[0, 2π)`. |
| `horizontal(vector, lstHours, latitudeDeg)` | `{alt, az, ra, dec, hourAngle, lstHours, latitudeDeg, azUndefined}`; angular fields in radians. |
| `toXYZ(horizontal, radius)` | `[east, up, south]` in scene units. |
| `meridianAltitude(decRadians, latitudeDeg)` | Upper-meridian altitude **in degrees**. |
| `rising(vector, latitudeDeg, horizonDeg)` | Status plus LST hours for actual crossings, nullable rise/set values, altitude bounds, and a tangent LST for an isolated grazing case. |
| `angularSeparation(a, b)` | Separation in radians, using normalized vectors. |
| `LIMITATIONS` | Machine-readable scope, omissions and interpretation notes. |

Defaults use Giza latitude 29.9753°. The module does not alter the latitude as the camera moves.

## Tests actually run

`node --test tests/test-sky.js`: **17 tests passed**. They cover all 152 sample anchors, every between-sample midpoint, orthonormality and determinant, a shortest-arc 180° crossing, old century-snap continuity, bounds, cardinal horizons, meridian altitude, periodic LST, geometric rise/set substitutions, circumpolar/grazing cases, the supplied rounded named-star reference table, year labels, and explicit invalid-input rejection.

These tests establish software invariants and consistency with the shipped reference table. They do not establish catalogue accuracy, archaeological intent, or a civil observing ephemeris.

## Primary convention sources checked

- [US Naval Observatory altitude and azimuth](https://aa.usno.navy.mil/faq/alt_az): local hour angle, horizon equations, north-clockwise azimuth, and `atan2` convention.
- [USNO sidereal time](https://aa.usno.navy.mil/faq/GAST): sidereal versus solar/civil time and the roles of Earth rotation and time scales.
- [USNO rise, set and twilight definitions](https://aa.usno.navy.mil/faq/RST_defs): geometric horizon, point-source versus solar/lunar disk definitions, and transit.
- [USNO Julian-date conversion](https://aa.usno.navy.mil/faq/JD_formula): explicit BC/astronomical-year example (4713 BC = astronomical −4712).

The source URLs support the conventions; they are not a validation of the supplied historic sky catalogue or of any archaeological alignment claim.
