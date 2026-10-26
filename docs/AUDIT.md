# Initial audit and implementation decisions

## Evidence available

The repository contained only `.git`, with no commits, source, or AGENTS.md. The sole supplied attachment was the written project handoff. No HTML prototype was available. Its code structure, behavior, and claimed defects cannot be independently assessed until it is supplied.

The handoff describes a monolithic browser prototype with close-hauled movement, seeded or random wind behavior, tack decisions, an emerging bear-away control, rotating finish gate, and approximately five-second numerical tack decisions. These descriptions are requirements and reported limitations, not code findings.

## Highest-priority audit targets once the prototype arrives

1. **Finish correctness:** check actual finite-segment intersections, direction and tack checks, interpolation, movement during tack penalties, and gate rotation. End-of-frame proximity and infinite-line checks can reward invalid routes. A rotating gate also requires time-dependent geometry.
2. **One physics model:** confirm the player and reference use identical units, heading conventions, start state, speed, penalties and finish logic. A small mismatch can invalidate every comparison.
3. **Bearing away:** check signed true wind angle, same-tack legality, forbidden no-go shortcuts, and behavior after a later shift makes the desired course illegal. Minimum wind angle is not a single allowed heading.
4. **Wind generation:** look for frame-dependent RNG, cumulative heading drift, forced symmetric reversals, phase resets, and nondeterministic replay. Reversing a shift does not require crossing the median.
5. **Optimization:** inspect action spacing, pruning, stopping criteria, bear-away coverage and artificial starting-tack restrictions. A five-second decision grid may miss good routes; a finer grid alone does not prove optimality.
6. **Rendering:** check equal physical scale, compass/course coordinate conversion, mobile course visibility, and whether UI changes mutate sailing behavior.

## Implemented first increment

- Separated geometry, configuration, wind, finishing, physics, replay, search and scoring from React and SVG.
- Centralized speed conversion (`1852/3600` meters/second per knot), tack penalties and legal headings.
- Implemented seeded bounded target-based oscillations and persistent shifts. Wind sampling is a pure function of scenario and simulation time.
- Implemented a stationary tack penalty with partial-step handling and no minimum starting-tack duration.
- Added same-tack gate aiming with a close-hauled fallback when the target is illegal.
- Implemented a finite, rotating finish gate with directional checks and substep crossing interpolation; a stationary boat cannot finish because the gate sweeps past it.
- Added numerical beam search, deterministic command replay and measured tack-delay comparisons in a background worker. Both player and solver start at the origin on starboard.
- Added course/follow views, digital compass, minimal sailing controls, advanced configuration, observed wind graph and route scoring. The reference's perfect future wind knowledge is revealed only after finishing.
- Added analytical steady-wind, movement, wind, finish and optimizer regression tests.

## Tradeoffs and next increments

The first search is deliberately bounded and explicitly approximate. It uses the same integration engine, but its decision set is narrower than all physically legal steering. Broaden bear-away targets/angles, refine tack timings around candidate decisions, add resolution/beam convergence studies, and compare against a separate high-resolution solver before making stronger quality claims. The default 2 s decision grid improves the earlier reported spacing but cannot certify the true optimum.

The engine's midpoint integration approximates continuous turning with wind; rotating-gate root finding interpolates each movement segment. Add convergence tests across timesteps and an independently integrated moving-gate oracle for more demanding accuracy work.

The agreed gate is a training finish convention, not a full implementation of racing rules, mark contact or hull clearance. A valid gate crossing has no collision/rounding-radius model. Preserve the convention until an explicit rounding model is agreed.

Next: import and audit the original prototype; compare behavior against the agreed brief; visually verify desktop/mobile layouts in a connected browser; improve optimization confidence and counterfactual quality; then add alternative-decision replay, scenario curricula and an opponent with limited wind knowledge. A more realistic tacking velocity profile should follow physics validation rather than be mixed into visual work.

## Verification of this increment

- `npm.cmd test`: 27 passing tests across two suites, including both persistent shift signs, oscillating wind, hard wind, deterministic replay, and the default 1000 m course.
- Independent 1000 m steady-wind analytical route matches exact time and distance within numerical tolerance. The 2 s search returns a two-tack route within 4 s of the analytical time lower bound including both penalties.
- `npm.cmd run build`: TypeScript checking and production bundling pass, including the optimizer worker.
- Launched the Vite development server and verified HTTP 200 at its local URL.
- Browser inventory exposed no connected browsers or native apps. No visual, responsive-layout, keyboard-interaction or real-browser worker smoke test was possible in this session. These remain verification work, not claimed passes.

## Vanilla conversion — feature/vanilla-html

Converted the framework implementation to static HTML, CSS and native JavaScript modules. The engine and search algorithms retain the same calculations and rules; TypeScript annotations were removed and browser imports now include `.js` extensions. React rendering was replaced with static semantic HTML and focused DOM updates. The player lifecycle is a rendering-free controller shared by the UI and its integration tests.

Removed React, React DOM, TypeScript, Vite, Vitest and their package dependencies. Node's built-in test runner now runs all 27 original regression cases. Added controller, full-leg replay, static module/MIME, DOM-binding, result-escaping and native worker protocol tests. Removed external font loading, so the application has no CDN or font-service dependency. Development serving and source checks use only Node built-ins; no build or package installation is required.

The native module graph is served and fetched over HTTP in an integration test, including the optimizer worker and its engine imports. The worker is additionally exercised in an actual Node worker thread with a browser-message bridge; that verifies imports, structured cloning and optimizer responses, but does not replace a real-browser smoke test. Browser inventory remains empty in this session, so visual desktop/mobile verification and actual browser interactions are still pending.

Deployment consists of `index.html` plus `src/` on any static HTTP host that serves JavaScript MIME types. Opening via `file://` is unsupported because native modules and module workers require HTTP. The local helper binds to loopback and serves only application assets.

Vanilla verification: all 38 tests pass using Node built-ins after pruning the previous package dependencies. `node scripts/check.js` passes syntax, import and HTML entry-asset checks for 23 JavaScript files. HTTP integration confirms the complete native module graph and stylesheet load successfully, including the worker entry. The limitations of the approximate optimizer remain unchanged.

## Traveling wind increment

Preserved the uniform wind sequence and added an optional traveling field by delaying the upwind source sequence according to down-course distance and configurable pattern speed. A shared position/time sampler now supplies the boat heading, midpoint movement, compass, optimizer, streaks and observed-wind history. The mark's local wind supplies gate and layline orientation. A persistent traveling scenario exposes a signed angle, entry start, transition width and propagation speed; seeded oscillating scenarios extend the same model to multiple regions.

The canvas draws below the course SVG using its aspect-preserving projection, with streak/front/hidden display options. Horizontal front transport is deliberately independent of local streak angle; this is labeled a simplified training model. Narrow fronts trigger adaptive integration within the fixed 0.25 s clock, and visual strokes shorten near strong gradients. See [the spatial model](SPATIAL_WIND.md) for equations and limits.

Verification: 61 tests pass, including all previous 38 regressions plus 23 spatial cases. Tests include a one-meter front checked against an independent fine RK4 calculation, position-dependent compass response, mark-local finite finish crossings, speed/frame/rendering isolation, positive/negative persistent routes, hard oscillating routes, and native worker replay under spatial wind. Syntax/import checks pass for 25 JavaScript files. The static server returns HTTP 200 for the HTML, canvas module and optimizer worker. Browser inventory still exposes no connected apps or browsers, so a live visual demonstration and desktop/mobile appearance remain unverified; the application includes a 300 m demo preset for manual inspection.
