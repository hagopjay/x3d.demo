// HAUL specifications: surfaces, the truck, its two powertrains, its tyres, the trailers.
// Everything the simulation knows about the world is here, in SI units, so it is one file to tinker with.

export const G = 9.81;

// Surfaces. mu: peak friction coefficient, dry, nominal tyre. wet: the fraction of mu a fully wet surface
// loses (mu_wet = mu (1 - wet x wetness)). shape: Pacejka C (lower = flatter past the peak; loose ground
// keeps building force as the tyre digs). kpk: slip ratio at peak. rr: rolling resistance coefficient.
// loose: how much a soft, aired-down tyre gains (0 hard ... 1 deep loose). sink: extra drag in mud (N per N of load
// at walking pace). Figures are the usual published ranges for truck tyres (dry asphalt 0.8-1.0, wet 0.5-0.7;
// gravel 0.6-0.75; packed dirt 0.65-0.8, wet 0.35-0.5; mud 0.25-0.45; wet clean rock 0.4-0.6).
export const SURFACES = [
  { id: 0, name: 'asphalt', mu: 0.95, wet: 0.32, shape: 1.45, kpk: 0.11, rr: 0.007, loose: 0.0, sink: 0.0, color: [0.20, 0.20, 0.22] },
  { id: 1, name: 'gravel', mu: 0.72, wet: 0.16, shape: 1.15, kpk: 0.18, rr: 0.018, loose: 0.6, sink: 0.0, color: [0.55, 0.50, 0.44] },
  { id: 2, name: 'dirt', mu: 0.78, wet: 0.46, shape: 1.25, kpk: 0.16, rr: 0.022, loose: 0.5, sink: 0.0, color: [0.47, 0.34, 0.22] },
  { id: 3, name: 'mud', mu: 0.46, wet: 0.36, shape: 1.05, kpk: 0.28, rr: 0.055, loose: 1.0, sink: 0.035, color: [0.33, 0.24, 0.16] },
  { id: 4, name: 'slab', mu: 0.88, wet: 0.44, shape: 1.50, kpk: 0.10, rr: 0.008, loose: 0.0, sink: 0.0, color: [0.50, 0.50, 0.52] },
  { id: 5, name: 'grass', mu: 0.62, wet: 0.50, shape: 1.20, kpk: 0.16, rr: 0.030, loose: 0.4, sink: 0.0, color: [0.24, 0.38, 0.16] },
];

/** Peak mu of a surface at a wetness (0..1) and puddle depth (m): the road part of the tyre's grip. */
export function surfaceMu(surface, wetness, puddle = 0) {
  const s = SURFACES[surface];
  const film = Math.min(1, puddle / 0.04);           // standing water: a further loss up to 30 %
  return s.mu * (1 - s.wet * Math.min(1, wetness)) * (1 - 0.3 * film);
}

// The truck: a 6x6 heavy wrecker/tractor. Origin at the centre of mass; x forward, y up, z left.
export const TRUCK = {
  name: 'HAUL 6x6',
  mass: 12500,                     // kg, chassis with cab, engine and fuel, without wheels
  size: [9.2, 1.4, 2.45],          // collision box, m (length, height, width)
  boxY: 0.25,                      // collision box centre above the centre of mass
  inertia: null,                   // from the box (Ammo), set in sim
  cgHeight: 1.25,                  // centre of mass above the ground at rest, m
  axles: [                         // x of each axle from the centre of mass, m; driven: in 6x4 and 6x6
    { x: 2.9, steer: true, drive6x4: false, load: 0.36 },
    { x: -1.55, steer: false, drive6x4: true, load: 0.32 },
    { x: -2.95, steer: false, drive6x4: true, load: 0.32 },
  ],
  track: 2.05,                     // m between wheel centres
  wheelRadius: 0.56,               // m (a 395/85R20 off-road truck tyre)
  wheelMass: 160,                  // kg each, wheel and tyre
  wheelInertia: 28,                // kg m^2 each
  suspension: { travel: 0.30, rest: 0.55, stiffness: 320000, damping: 34000, bump: 0.08 },  // per wheel: leaf spring ~0.65 damping ratio
  steerMax: 0.62,                  // rad at the road wheels
  steerRate: 1.1,                  // rad/s
  brakeTorque: 26000,              // N m per wheel, full pedal
  hitch: [-2.3, 0.35, 0],          // fifth wheel, over the tandem, from the centre of mass
  exhaust: [[1.15, 2.15, 1.05], [1.15, 2.15, -1.05]],   // twin stacks behind the cab (tops), from the centre of mass
  dragArea: 7.5,                   // Cd A, m^2
};

// Diesel: a 15 l straight six, 450 kW (605 hp) at 1,800 rpm, 2,780 N m (2,050 lb ft) from 1,000 to 1,400 rpm,
// with a turbo that has to spool, an Allison-style 6-speed automatic with a torque converter, and an exhaust brake.
export const DIESEL = {
  idle: 600, redline: 2100, cut: 2250,
  rpm: [500, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2100, 2250],
  torque: [900, 1300, 2150, 2780, 2780, 2780, 2620, 2390, 2050, 1800, 0],   // N m at full boost
  naFraction: 0.42,                // torque available with no boost
  spool: 0.55,                     // s to build boost at 1,400 rpm (scales with 1,400 / rpm)
  inertia: 3.2,                    // kg m^2, engine and converter pump
  friction: [140, 0.075],          // N m at idle + per rpm, motoring
  exhaustBrake: 1600,              // N m of retard with the exhaust brake on
  fuelMap: 0,                      // 0 stock ... 1 "rolling coal": +8 % torque, black smoke
  converter: { stallTR: 2.4, couplingSR: 0.86, kStall: 33, lockSR: 0.82 },   // K in rpm / sqrt(N m): stall at ~1,750 rpm against 2,780 N m
  gears: [3.51, 1.91, 1.43, 1.0, 0.75, 0.64], reverse: -4.8,
  shiftUp: 1950, shiftDown: 1150, shiftTime: 0.45,
  bsfc: 200,                       // g/kWh at the best point (fuel use and smoke)
};

// EV: two axle motors (front, and a tandem pair), 700 kW together, 65 kN m at the wheels to base speed, one speed,
// instant torque, motor-level traction control, regenerative braking, a 600 kWh pack.
export const EV = {
  wheelTorque: 65000,              // N m at the wheels, all motors, to the base speed
  power: 700000,                   // W
  maxWheelRpm: 900,
  regen: 0.35,                     // fraction of wheelTorque when coasting (one-pedal)
  battery: 600,                    // kWh
  efficiency: 0.9,
  tcSlip: 0.10,                    // traction control target slip
  batteryMass: 2500,               // kg more than the diesel's engine, tank and gearbox
  heatTime: 35,                    // s: the motors' and inverters' thermal time constant
  derateFrom: 0.72,                // heat (0..1) where torque starts to fall
  derateTo: 0.5,                   // torque fraction left when fully hot
};

export const DRIVETRAIN = { final: 5.29, low: 2.6, efficiency: 0.92 };

// Tyre: relaxation lengths (m) let force build like a spring at a standstill, so the truck can hold on a hill.
export const TYRE = {
  relaxX: 0.45, relaxY: 0.65, apk: 0.14,       // lateral slip (tan alpha) at peak
  loadSensitivity: 0.08,                       // mu falls 8 % per extra nominal load
  nominalLoad: 22000,                          // N
  pressure: { nominal: 7.5, min: 2.0, max: 8.5 },   // bar. Aired down: a longer patch grips loose ground better
  lowSpeedDamping: 9000,                       // N s/m on the slip speed below 2 m/s
};

/** Tyre pressure's effect on grip and rolling resistance (soft = longer patch). */
export function pressureEffect(pressure, surface) {
  const s = SURFACES[surface];
  const soft = (TYRE.pressure.nominal - pressure) / (TYRE.pressure.nominal - TYRE.pressure.min);   // 0 nominal .. 1 min
  const grip = 1 + soft * (0.04 + 0.16 * s.loose);          // +4 % hard ground, +20 % deep loose
  const rr = 1 + soft * (0.9 - 0.7 * s.loose);              // soft tyres drag on hard ground, float on soft
  return { grip, rr };
}

// Trailers: a gooseneck lowboy on the fifth wheel; payloads differ by level.
export const TRAILER = {
  deck: [11.0, 1.1, 2.5],          // m
  emptyMass: 6500,                 // kg
  kingpin: [5.0, 0.35, 0],         // from the trailer's deck centre, forward
  axles: [-3.6, -4.9],             // x from the deck centre
  track: 2.05, wheelRadius: 0.5, wheelMass: 120, wheelInertia: 18,
  tongueShare: 0.28,               // of the payload carried by the fifth wheel at rest (set by where it is placed)
};
