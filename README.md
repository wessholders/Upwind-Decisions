# Upwind Decisions

A vanilla HTML, CSS, and JavaScript sailing trainer with a deterministic, rendering-independent engine. Sail an upwind leg by deciding when to tack, then compare with a hindsight reference using the same physics and wind. No frameworks, package dependencies, transpilation, or build step.

## Run

Serve this folder with any static HTTP server. The included development server and tests use Node 22.12+ (verified with Node 24); **no `npm install` is needed**.

```sh
node scripts/serve.js
```

Open http://127.0.0.1:5173/. To use another port, set the `PORT` environment variable. Native JavaScript modules and module workers require HTTP serving; double-clicking `index.html` using `file://` is not supported. No application backend is required.

```sh
node --test tests/*.test.js
node scripts/check.js
```

Optional npm aliases: `npm run dev`, `npm test`, and `npm run check`. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

To deploy, upload **`index.html` and the `src/` directory** together to a static host. Paths are relative, so deployment in a subdirectory is supported. There is no `dist/` build output. The host must serve `.js` with a JavaScript MIME type for native modules and the optimizer worker.

## Sailing

- Start on starboard; the boat automatically follows the changing wind close-hauled.
- Use **Tack** (keyboard T) to change tack. Both player and reference stop for the configured penalty. Space starts/pauses.
- **Bear away to gate** becomes available when aiming at the gate center is legal on the current tack. It never crosses the no-go zone. Return to close-hauled at any time.
- Cross the finite dark gate right to left on starboard. It extends upwind from the mark and rotates with the wind. Laylines are visual references, never boundaries.
- New wind creates a seed; retry preserves the exact scenario. Advanced settings apply when you reset the leg.
- The gold hindsight route and numerical decision comparisons appear after finishing. The search includes your completed route as an incumbent, so beam pruning cannot discard a faster known valid result.

Defaults: 1000 m course; 5 kn boat speed; minimum 45° true wind angle; 5 s stationary tack penalty; 5 m boatlength; 20-boatlength (100 m) finish gate; ±15° wind bound. No current, waves, wind-strength variation, polar curve, or apparent-wind model.

## Architecture

```text
index.html               semantic HTML, controls, settings and instruments
src/styles.css           responsive layout using local font fallbacks
src/engine/
  config.js      units, defaults, validation, fixed timestep
  geometry.js    angles, vectors, tack legality, laylines
  wind.js        seeded scenario generation and time-indexed interpolation
  finish.js      finite rotating gate and crossing interpolation
  physics.js     single authoritative boat model and commands
  race.js        deterministic command replay
  optimizer.js   bounded beam search and tack counterfactuals
  scoring.js     route comparison and formatting
src/views/               course SVG, observed wind history, post-race analysis
src/race-controller.js   rendering-free player lifecycle and fixed-step clock
src/main.js              native DOM bindings and animation/worker lifecycle
src/optimizer.worker.js  native module worker for hindsight calculation
scripts/serve.js          optional dependency-free local HTTP server
scripts/check.js          JavaScript syntax and module/asset checks
tests/                   Node test runner; physics, replay, controls, serving and workers
```

The view uses SVG's uniform `preserveAspectRatio="xMidYMid meet"` transform: equal horizontal and vertical meter scales in both camera modes. Boat symbols are enlarged for readability; the underlying positions, gate, and laylines use meters. Baseline compass wind changes compass readings without rotating the course.

## Numerical limits

The integrator uses a maximum **0.25 s** step and midpoint wind direction. Playback uses only fixed steps, independent of refresh rate. Tack penalties and finish times may end on a partial step. Finish detection evaluates the rotating gate and uses bisection within a linear movement substep. Movement and rotating-gate crossing therefore remain numerical approximations, not exact continuous-time solutions. Extremely fast externally supplied wind curves are outside the tested generator's range.

The benchmark uses a 4 s coarse search followed by a 2 s search with a 140-state beam and 2 m position cells. It includes hold, tack, gate-aim, and close-hauled actions. Gate aiming targets the center of the finite gate; it does not enumerate every legal bearing-away angle. Its heuristic estimates travel using frozen current wind and is not an admissible bound under future shifts. Pruning, time/space discretization, a finite horizon, and the restricted steering set can all miss better routes. **Best route found numerically; global optimality is not certified.**

Tack feedback compares the selected finish time with a fresh search that first continues for two seconds from the same preceding route. It reports measured completion times, including improvements or failures to find a valid continuation. This is a search comparison, not proof of causation or a certified advantage. The first eight reference tacks receive comparisons to bound processing time.

Wind knots are generated at scenario creation and queried by simulation time. Oscillations sample bounded independent targets, with randomized holds and smoothstep transitions, permitting several shifts on the same side of the median. Difficulty scales hold/transition times (easy 1.6×, medium 1×, hard 0.45×). Persistent scenarios randomize start, sign, magnitude and duration from the seed, then hold the final wind. Generated oscillations cover five hours; the final direction is held after that horizon.

The interface runs entirely in the browser. Fonts and assets use local resources; there are no CDN imports or remote font requests. The optional local server only serves static files. No account, database, analytics, deployment, or external data service is configured.

## Handoff status

The provided attachment contained the project brief only. This repository was empty, so this is a new implementation from the specified rules, **not a verified port or audit of the missing HTML prototype**. See [the audit and next steps](docs/AUDIT.md).
