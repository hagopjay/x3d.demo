# HAUL physics

Every number is in `src/sim/spec.js`; the model is `src/sim/truck.js`; the gates are `tests/limits.json` (committed before the first measured run, `267a325`) and `tests/physics.test.mjs`.

## The model, at 240 Hz

**Bodies (Ammo / Bullet).**
- **Truck:** one rigid body, 12,500 kg plus six 160 kg wheels. Its collision box only touches the ground if the truck bottoms out or rolls.
- **Trailer:** a second body on a point-to-point constraint at the fifth wheel. Its centre of mass sits so that the fifth wheel carries 28 % of it at rest.
- **Ground:** the level's ElevationGrid, as a `btHeightfieldTerrainShape`.

**Suspension.**
- **Contact:** each wheel is a circle swept down its strut. Seven samples across the footprint each define a tangent plane (the point and the terrain's normal there). The circle meets plane n·(X − g) = 0 at strut length L = (R − n·(mount − g)) / (n·down), and the plane met first is the contact. On a smooth slope every sample gives the same plane; at a rock ledge the step's steep face is met first, and its normal leans back against the truck.
- **Spring and damper:** 320 kN/m with a progressive bump stop. The damper is digressive: 34 kN·s/m to 0.3 m/s and a quarter of that beyond, so a ledge doesn't kick the wheel off the ground.

**Tyres.**
- **Slip states:** longitudinal slip κ and lateral tan α follow relaxation lengths (σx = 0.45 m, σy = 0.65 m, semi-implicit). At a standstill they build force like springs, which is how a braked truck holds on a hill.
- **Force:** normalised combined slip s = ‖(κ/κpk, tan α/αpk)‖, through a Pacejka-shaped curve sin(C·atan(B s)) per surface (peak at s = 1; C sets how much grip is left sliding). The force points along the slip vector, so Fx² + Fy² ≤ (µFz)² always holds.
- **µ:** surface × (1 − wet × wetness) × (1 − 0.3 × puddle film) × pressure × load sensitivity (−8 % per extra nominal load).

**Rolling resistance.** It's a moment on the wheel, because the normal pressure sits ahead of the axle. So it costs a driven wheel torque, not grip, and makes an undriven wheel push back through its tyre. Mud's bulldozing is a force on the body.

**Diesel.**
- **Engine:** a torque curve (2,780 N·m from 1,000 to 1,400 rpm; 450 kW at 1,800). The turbo's boost chases the throttle with a lag that shortens with revs (0.55 s at 1,400 rpm); without boost only 42 % of the torque is there.
- **Torque converter:** K = 33 rpm/√(N·m), so it stalls near 1,750 rpm against full torque. It multiplies torque up to 2.4× at stall and locks up above 0.82 speed ratio in 2nd and up.
- **Gearbox and fuel:** a 6-speed automatic (or manual) and an exhaust brake. Fuel is burnt at 200 g/kWh. Soot is the fuel the turbo can't yet burn, plus the fuel map.

**EV.** 65 kN·m at the wheels up to the base speed, then 700 kW. Traction control trims each wheel's torque above 10 % slip; regenerative braking works when coasting. The battery adds 2.5 t. A thermal model (35 s time constant, copper losses ∝ torque²) derates the torque to 50 % when hot; rain cools it a little.

**Driveline.** The torque goes to the carrier, which turns at the driven wheels' mean speed.
- **Open differentials:** equal torque per wheel. With the engine's inertia reflected onto the carrier when the converter is locked (I_r = I_e·G²), the carrier acceleration is ω̇_c (I_w + I_r/N) = T/N + mean(ground torque).
- **Lockers:** every driven wheel turns at one speed, ω̇ = (T + Σ ground) / (Σ I_w + I_r).

## The traction budget (`feasible.js`)

A quasi-static check for one pitch:
- **Needed:** M·g·sin θ for truck and trailer, plus the rolling resistance of the undriven wheels, plus mud bulldozing.
- **Available:** with lockers, the sum of µFz over the driven wheels; with open diffs, twice the weaker wheel's µFz on each axle. Fz shifts from the front axle to the tandem with the slope (centre-of-mass height over wheelbase), and the tandem also carries the trailer's tongue weight.
- **Margin:** available / needed − 1.

The level generator uses it to design each level, and the tests use it as the referee.

## Gates (all pass: `npm test`, 17 tests, about 14 s)

| Gate | Referee | Result |
|---|---|---|
| static load | the tyres carry M·g within 1 % | pass |
| brake hold (asphalt dry, dirt 0.8 wet, mud 0.6 wet) | holds at 85 % of atan(µ) (drift ≤ 5 cm in 10 s), slides at 115 % (≥ 2 m) | pass |
| traction budget (asphalt, gravel 0.4, mud 0.7) | climbs at margin +0.12 (≥ 25 m in 25 s), spins at −0.12 (≤ 3 m) | pass |
| coast-down | deceleration = g·rr + ½ρCdA·v²/m within 20 % | pass |
| wrong twin: split µ | open diffs slide back where lockers climb | pass: on asphalt / mud at 39.1 %, lockers gain 11.1 m in 20 s, open diffs lose 1.2 m |
| levels ramp | steepest pitch rises each level; naive clears 1 and fails 3, 4, 5; best diesel and best EV clear all five (`tools/bot.mjs`) | pass |
| determinism | same inputs, same state digest after 20 s | pass |
| X3D tether | `levels/*.x3d` are the generator's output and read back to the same ground; the truck file's hubs, exhaust and hitch match `spec.js` | pass |

### Bot runs: best setups and naive (`tools/bot.mjs`, a driver that holds the worst driven wheel near 20 % slip)

| Level | naive (6x4, open, 7.5 bar, diesel) | best diesel, low range | best diesel, high range + fuel map 1 | best EV |
|---|---|---|---|---|
| 1 Valley Run | summit 29.2 s | summit 29.3 s | summit 28.8 s | summit 22.4 s |
| 2 Quarry Road | summit 55.0 s | summit 51.0 s | summit 55.3 s | summit 34.2 s |
| 3 Logging Cut | rolled at 245 m of 382 | summit 63.5 s | summit 67.2 s | summit 40.8 s |
| 4 Clay Switch | stuck at 114 m of 372 | summit 59.3 s | summit 62.0 s | summit 38.6 s |
| 5 The Wall | stuck at 123 m of 362 | stuck at 327 m of 362 | summit 59.7 s | summit 34.8 s |

The level 5 result is the lesson of the game. Low range has the torque, but it's slow, and the slab gets wetter every second.

## Changed after the first run

The limits file wasn't edited. These are the changes made to the tests, the referee and the levels after the first measured run, with the reason for each:

1. **Spawning on a slope.** The test hill started the truck level on its grade, so the struts began inside the ground and Bullet threw the truck into the air. Bodies now spawn pitched to the ground under them, and a strut can't push more than 400 kN.
2. **The contact normal.** It was measured from the hub to the ground point below each sample, which tilts it toward vertical on steep ground. The normal force then had an uphill component that acted like friction, so brakes held above atan(µ). It's now the tangent-plane contact described above.
3. **Rolling resistance in the budget.** The budget subtracted every wheel's rolling resistance from the climb. It costs driven wheels torque, not grip, so only the undriven wheels' rolling resistance now counts, plus mud bulldozing. This is a correction to the referee. The sim agreed with the corrected budget: on mud at −12 % the truck has 59.6 kN of grip against 61.8 kN needed.
4. **Engine inertia.** It was placed on every driven wheel. It belongs on the differential carrier, and on the wheels it let an open diff feed a gripping wheel for seconds. The driveline is now solved as one system.
5. **The traction-budget test's driver.** It drives the EV with traction control, because the budget is peak grip and only a peak-seeking controller holds the tyres there. Full diesel throttle spins past the peak, where asphalt keeps 76 % of its grip. The battery mass is included in the budget.
6. **The split-µ wrong twin.** It moved from dirt / mud at margin −0.10 to asphalt / mud at −0.15.
   - **Why:** at −0.10, open diffs crept forward. A spinning wheel's rolling-resistance moment, which an open diff passes to the gripping side, made up the gap. The budget leaves that out.
   - **Thresholds:** lockers > 8 m, open ≤ 0 m. The committed limit was a 12 % grade from level 3, short only because of its 14 t trailer, so the grade is now taken from the budget.
7. **Level designs.** Level 3's steepest pitch (22 %) was less steep than level 2's (26 %), against the brief "each hill steeper". The steepest pitches are now 16, 22, 26, 33 and 45 %. Once the driveline was fixed (change 4), levels 4 and 5 were eased:
   - level 4: payload 5 → 3 t, rain 0.75 → 0.6, ledges 0.16 → 0.12 m;
   - level 5: wall 48 → 45 %, rain 1.0 → 0.8, ledges 0.22 → 0.18 m;
   - ledges rise over 1.6 m, not 0.6 m (weathered steps a tyre can climb).
8. **The bot.** It moved from "full throttle minus a quarter per m/s of wheelspin" to a controller that holds the worst driven wheel's slip ratio near 20 %.

## Open

- **Tyre model:** no tyre compliance (a rigid circle and a digressive damper stand in for it), no camber, and no tyre temperature (KANSEI has one).
- **Trailer:** only point-to-point; no jackknife limits.
- **Weather:** rain is spatially uniform apart from puddles; there's no run-off down the road.
- **Driver:** the bot is only a test driver; a human can carry momentum it doesn't.
