# NPC Phase 4: simplified fleet

Select **Race NPCs**, then 1–8 boats in the existing Opponent setup card.
Solo Training runs zero opponents. Start Race, pause, retry, new scenario,
course selection, human controls and hindsight inspection retain their existing
behavior. The standings panel and per-boat decision log accompany the course.

## Implementation

`src/engine/race-fleet.js` materializes a frozen, versioned descriptor containing
each entrant's identity, color, control type, All-Rounder configuration, variation
seed, starting position and planning phase. Instantiation creates fresh boat,
track, command, decision, planning-memory, commitment and statistics objects.
Descriptors can be serialized and instantiated again without consuming wind RNG.
Runtime planning objects never belong to more than one boat.

The eight-boat roster has three Beginners, two Intermediates, two Advanceds and
one Elite. Smaller rosters distribute available slots across those tiers, always
including Elite; one opponent is Elite. The two ordinary All-Rounder presets
alternate and Elite uses its existing preset. **All strategy weights, physics,
tack behavior, visibility limits, planning horizons and work budgets are retained.**
Elite retains Phase 3's strongest validated skill (`beginner`), rather than
assuming the more expensive Advanced search is stronger. These labels are not
a guarantee of finishing order; skill calibration remains a separate task.

Each boat has a separate seed stream. Non-Elite boats receive ±5% switching
threshold variation and ±0.5 s commitment variation. Elite keeps its validated
thresholds. Seeded lanes and planning phases add independent variation for all
boats. No random values are consumed per animation frame or from a shared NPC RNG.

Human starts at (0, 0); NPCs occupy shuffled lanes at ±3, ±6, ±9 and ±12 boat
lengths on the same start line. Adjacent starting centers are at least three
boat lengths apart. AR1–AR8 have distinct colors, excluding the selected human
color. Lanes are not dynamically reallocated or balanced for starting advantage.

The existing trainer advances every boat through the same scenario and shared
physics on 0.25 s simulation steps. The planner reads the existing permitted
present observations; descriptors and standings add no future wind information.
Initial planning phases are distinct quarter-second slots within 0–1.75 s.
Periodic replanning stays anchored to these slots after tactical decisions;
scheduled tacks and post-turn decisions can run earlier when needed. There are
no wall-clock deadlines or frame-dependent reductions in planning quality.

Every finish retains its fractional crossing time and frozen boat state. Other
boats keep racing after the human or first NPC finishes. Final placements use
finish times, with ties within 0.1 microsecond sharing a competition place.
Live order uses distance to the finite finish segment and is explicitly
provisional: it does not estimate tactical advantage or remaining legal maneuvers.
Timeout boats retain their own time-limit status.

`raceEntrants` and `raceStandings` consume boat records plus role/control metadata,
independently of personality. Descriptor instantiation accepts existing policy
configurations, so other personalities need roster wiring rather than another
race loop. Future human controllers can supply the same boat/identity records;
their input transport and control adapter remain future work. No networking or
collision system is introduced here.

Compatibility: explicit `npcCount` enables the new fleet. Programmatic callers
omitting it keep the previous single-controller configuration API and
`state.computer` alias. Solo retains only a dormant compatibility object, which
is neither simulated nor counted as an entrant. Offset starts replay using
`replay(scenario, commands, until, initialBoat)`. Fleet command logs are excluded
from the origin-zero human hindsight incumbent search to avoid invalid replays.

Rendering draws all boats/tracks, includes fleet tracks in full-course bounds,
and follows the human in follow mode. Append-only track path/bounds caches avoid
rescanning nine histories on each frame. No planner or physics optimization was
needed to enable the fleet.

## Validation and reproduction

- `npm test`: 273 tests in 48 suites, including the existing legacy fixtures,
  planner/personality regressions and 11 new fleet tests.
- `npm run check`: 98 JavaScript files/imports/HTML assets checked.
- `npm run build`: static build passed.
- `node scripts/npc-fleet-benchmark.js`: actual eight-boat races across all three
  course modes, six weather/current fixtures and all four playback speeds.
  Complete per-NPC state digests must match across speeds. Every first-speed
  run also replays every boat from its own starting position through shared
  physics. Machine-readable results: `NPC_PHASE_4_BENCHMARK.json`.
  **72 fleet races / 576 NPC starts / 576 finishes**; eight distinct complete
  command histories in every race; all 18 environment cases match at all four
  speeds. Maximum tack count was seven. The traveling upwind fixture produced
  38 per-decision work-budget exhaustions per speed run (152 total); the existing
  bounded fallback handled these and every boat finished. Early stretches of
  steady wind can legitimately produce the same commands on several boats.
- With `npm run dev` and isolated Chromium/Edge CDP on port 9226,
  `node scripts/fleet-browser-check.js` tests ready/pause/restart, the human plus
  all eight NPCs finishing in every course mode, nine-row placements, log
  selection, frozen finish positions and mobile layout. It then measures actual
  RAF performance with organic wind, 1.2 kn cross-current, all eight NPCs,
  wind particles and rendering at 1×/4×/8×/16×. Results:
  `NPC_PHASE_4_BROWSER.json`; screenshots in ignored `artifacts.local/fleet-*.png`.
- Existing `scripts/game-browser-check.js` passed with zero runtime errors,
  covering solo/single-NPC navigation, input, all speeds, mobile display, all
  course modes, current and hindsight inspection. Set `CDP_URL` to the isolated
  browser URL (default port 9225 for that older script).

Performance measurements are five seconds per speed/view size on desktop
hardware, with headless Edge and mobile viewport emulation. They are not a
real-phone certification or an exhaustive stress test. Forecast budgets and
memory ownership remain deterministic. Collision avoidance, right-of-way,
wind shadows, multiplayer transport and personality selection remain out of scope.

Final Edge 157 measurements on an Intel Core Ultra 9 285HX:

| Viewport | 1× FPS | 4× FPS | 8× FPS | 16× FPS |
| --- | ---: | ---: | ---: | ---: |
| Desktop 1440×1000 | 60 | 60 | 60 | 56 |
| Mobile emulation 390×844 | 60 | 60 | 60 | 60 |

Desktop 16× p95 frame interval was 33.3 ms, with no long tasks detected during
the measured windows. These final measurements ran after the full engine
benchmark; a preliminary run under concurrent benchmark load reached 34 FPS at
desktop 16×. Main-thread planning and wind rendering can still contend on slower
hardware. All three course modes completed with nine browser finishers and no
runtime errors. Start markers are sized for the separated lanes, with staggered
identifier labels; boats can converge later because collisions are out of scope.

## Files for this phase

Created `src/engine/race-fleet.js`, `src/views/standings.js`,
`tests/fleet.test.js`, `scripts/npc-fleet-benchmark.js`,
`scripts/fleet-browser-check.js`, this report and the two Phase 4 JSON reports.

Modified `src/race-controller.js`, `src/engine/live-computer.js` (optional
anchored planning cadence), `src/engine/race.js` (optional replay start),
`src/scenario-config.js`, `src/game-shell.js`, `src/main.js`,
`src/views/course.js`, `src/views/computer.js`, `index.html` and `src/game.css`.
The shared physical/environment models, policy implementations, strategy weights,
legacy-reference source and legacy fixtures are unchanged by Phase 4.
