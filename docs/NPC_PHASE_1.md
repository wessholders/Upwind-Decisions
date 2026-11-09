# NPC Phase 1: architecture and intelligence foundation

The default trainer still races one **unrated legacy reference**, using the
policy from revision `1f9a90f`. No new planner, personality behavior, fleet UI,
physics, environmental generation, or hindsight integration is introduced.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/engine/npc-config.js` | Immutable, versioned NPC descriptors; skill/observation profiles; personality identifiers; planned roster metadata. |
| `src/engine/npc-observation.js` | The privileged observation adapter; present-only sampling, visibility enforcement and immutable plain snapshots. |
| `src/engine/npc-legacy-policy.js` | The original policy and its original frozen-map forecast, moved without retuning. |
| `src/engine/npc-policy.js` | Named policy interface and dispatcher; owns no scenario or environment callbacks. |
| `src/engine/npc-data.js` | Plain-data ownership, serialization validation and immutability helpers. |
| `src/engine/live-computer.js` | NPC lifecycle, per-instance runtime memory, authoritative actions/movement and backward-compatible exports. |

The existing `observeCurrentWind`, `sampleObservedMap`, `forecastObservedOption`
and `decideLiveComputer` imports from `live-computer.js` remain valid.
`decideLiveComputer` is an alias of `decideLegacyComputer`, not a second policy.

## Configuration and state

```js
const computer = createLiveComputer({
  id: 'experimental-puff-hunter',
  skillId: 'beginner',
  personalityId: 'puff_hunter',
  // Optional, reserved metadata. No variation is generated or applied yet.
  variation: { seed: 42, parameters: {} },
});
```

`computer.configuration` is a detached, deeply frozen JSON descriptor:

- `schemaVersion`, stable `id`, `policyId`, `policyVersion`;
- `skillId`, `skillProfileVersion`, `personalityId`, `personalityVersion`;
- resolved `observationProfileId` and optional seeded `variation` metadata.

The current schema/profile/policy versions are 1. Unknown IDs or versions are
rejected instead of silently falling back. Configuration can round-trip through
JSON into `createLiveComputer()` or `createNpcConfiguration()`.

The default `skillId` is `null`: the existing reference has not been empirically
assigned a gameplay skill. It uses `legacy-v1` observations. This compatibility
profile is separate from the three named, opt-in skill levels.

Mutable `planningMemory` and `commitment` belong to each NPC. They are not part of
immutable configuration. Existing `boat`, `track`, `commands`, `decisions`,
`nextDecision`, `lastTackTime`, `status` and `latestReason` remain available.
`lastTackTime` remains the compatibility scheduling field and is synchronized
into policy memory. Commitment is currently an inert data container; it does
not select or enforce a course side.

Default instances deliberately use the same `legacy-computer` ID; callers
creating multiple experimental instances must supply distinct stable IDs.
There is no global counter, unseeded random assignment, or active fleet manager.

## Skill and personality

`SKILL_PROFILES` defines `beginner`, `intermediate`, and `advanced`. Each includes:

- observation profile;
- decision interval and planning horizon;
- decision depth and candidate budget;
- environmental interpretation mode;
- commitment/hysteresis description.

Only **observation differences** are newly operational. All three profiles retain
the reference's 2 s cadence, 60 s horizon, single-action depth, two-candidate
budget, frozen-present interpretation and existing hysteresis. These fields
describe available capabilities and provide integration points for future
policies. They do not claim different strategic competence yet. The reference
forecast/hysteresis constants remain locked in its implementation.

Personality and skill are independent. The stable identifiers are:
`all_rounder`, `puff_hunter`, `shift_hunter`, `tack_minimalist`, `side_specialist`,
and `current_strategist`. Each personality explicitly has
`status: 'identifier-only'`. The legacy policy ignores personality and variation.

`PLANNED_NPC_ROSTER` records eight future slots: three All-Rounders, Puff Hunter,
Shift Hunter, Tack Minimalist, Side Specialist, and Current Strategist. It creates
no boats. The elite slot requires a strongest validated future planner; it does
not assign that status to the legacy algorithm.

## Observation profiles and information limits

`observeCurrentWind(scenario, boat, profile)` accepts a registered profile ID or
an explicit validated observation-profile object. Serialized NPC configuration
uses registered IDs only. Grid dimensions are bounded to 2–65 per axis.

**These visibility values are provisional engineering values, not final gameplay
tuning.** Distances use course X/Y axes, with +Y forward up-course. They do not
rotate with the boat's heading. Left/right limits are symmetric about boat X.

| Profile | Grid | Forward | Aft | Each lateral side |
| --- | --- | --- | --- | --- |
| `legacy-v1` | 17 x 21 | Original full-course bounds | Original bounds | Original bounds |
| `beginner-v1` | 9 x 11 | 40 BL / 200 m | 10 BL / 50 m | 20 BL / 100 m |
| `intermediate-v1` | 13 x 17 | 90 BL / 450 m | 15 BL / 75 m | 50 BL / 250 m |
| `advanced-v1` | 17 x 21 | 220 BL / 1,100 m | 16 BL / 80 m | 116 BL / 580 m |

Meter values assume a 5 m boat. All profiles currently use exact vector samples;
`precision: 'exact-vectors'` makes that explicit. No noise or quantization is
implemented. Sampling outside a map clamps to its edges and cannot query the
authoritative environment.

The legacy default retains the original expanding rectangle and upstream
margin, including the known traveling-source preview above the wind-entry
boundary. Removing it would alter reference observations and potentially
reference decisions, so it is deliberately preserved and tested.

Every nonlegacy profile requires `upstreamLimit: 'wind-entry'`. Its upper bound
is capped at `courseLength + boatLength * gateBoatLengths`, so traveling samples
never evaluate later source-sequence times. If a boat itself sails above entry,
the observation anchor and local wind sample remain at entry. The actual boat
continues sailing in the unchanged authoritative environment.

Coverage restrictions include indirect sampling:

- Restricted rounding-gate orientation is estimated from the permitted wind
  map, including edge extrapolation if the mark is unseen. The adapter does not
  sample remote mark wind to construct the policy's gate snapshot.
- Restricted heading is derived from permitted wind/course estimates and boat
  maneuver state. It does not call authoritative heading/speed functions that
  could query unseen wind while aiming at the gate.
- Actual stored boat speed is known own-boat state. An unset initial speed is
  estimated using the shared polar and permitted wind.
- Fixed finish locations and course rules are public static information.
  Current is the same public, uniform race vector for all boats.

Nonlegacy snapshots include `perception` provenance: profile ID, actual wind
sample position, whether that sample is at the boat, and whether heading/course
geometry are estimates. The legacy snapshot's data shape remains compatible.

The adapter whitelists public configuration, course fields and maneuver state.
It retains no scenario references and exposes no functions, seeds, future
schedules, feature lifetimes, spawn records, or hindsight routes. Snapshots are
deeply immutable. The boundary is a data/capability contract, not a security
sandbox for malicious JavaScript running in the same application realm.

## Policy interface

```text
decide({
  observation,  // immutable permitted boat/environment snapshot
  skill,        // immutable resolved profile
  personality,  // immutable identifier/status descriptor
  memory,       // immutable snapshot of this NPC's runtime planning memory
  commitment,   // immutable snapshot of this NPC's strategic commitment
  variation     // immutable reserved seeded metadata, or null
}) -> {
  action, reason, options, memory, commitment
}
```

`LEGACY_REFERENCE_POLICY` is registered as `legacy-reference`, version 1.
`evaluateNpcPolicy()` resolves inputs and detaches returned memory/commitment for
the owning NPC. Actions continue through authoritative `applyAction()`; actual
movement continues through `advance()`. The policy receives no clock, RNG,
environment sampler or scenario object.

The dispatcher uses an already immutable observation directly, avoiding another
grid copy. Caller-supplied mutable observations are copied and frozen. Runtime
memory is copied at the boundary; future planners should keep it bounded rather
than copying entire route trees into memory each decision.

## Legacy compatibility and intentional differences

The default race controller is unchanged. It still calls `createLiveComputer()`
without options and advances it in 0.25 s simulation steps. The reference retains:

- original 2 s scheduling, observations and starting tie rule;
- original navigation overrides, 1.5 s improvement threshold, pressure/angle
  gates, settling interval and maneuver availability checks;
- original 60 s frozen-map projection and terminal ETA approximations;
- original current, tack/recovery, finish and timeout behavior;
- original action logs, explanations and replay format.

Intentional architectural differences: state now carries configuration and
independent memory/commitment, and policy observations are immutable detached
data. Explicitly selecting a named skill changes its observation inputs, so
those opt-in races are not claimed to match legacy traces. No current UI selects
those profiles.

Known reference limitations remain: terminal ETA omits current velocity;
forecast integration is separate from actual physics; no mid-window policy
branching; no general boundary rule; large direct update durations do not catch
up every decision; player steering remains wall-time based. None is silently
fixed or retuned here.

## Shared-physics forecast seam for Phase 2

No new forecast engine or physics-provider API is implemented in Phase 1.
Currently `advance()` and related functions accept a concrete scenario.

A later extraction can place environmental sampling, integration-step advice,
course geometry and finish evolution behind a provider accepted by the shared
physics. The live adapter would supply the real environment; a planning adapter
would supply only a frozen or explicitly predicted field derived from permitted
observations, plus permitted course estimates. Both must use the same boat,
polar, maneuver and current integration. Keep provider callbacks inside the
simulation/forecast adapter, never in policy input. Prove legacy forecast
compatibility before replacing the existing reference projection.

Hindsight retains its separate authoritative scenario access. Side Specialist
initial intelligence and current-optimized planning are not implemented.

## Verification and remaining scope

`tests/fixtures/npc-legacy-v1.js` was captured from unmodified `1f9a90f` before the
refactor. Eight races cover both rounding sides, fixed finish, oscillating wind,
traveling wind, organic 300 m/1 km, and current. Tests check exact command traces,
explanations and actions; numeric finish/decision results use 1e-8 tolerance.

`tests/npc-foundation.test.js` additionally verifies physics parity under identical
inputs, bounded queries including indirect mark/heading queries, unseen-wind
indistinguishability, traveling upstream isolation, immutable plain snapshots,
independent memory, versioned JSON configuration, unchanged controller lifecycle,
and matching NPC state across 1x/4x/8x/16x playback. Existing tests are unchanged.

Future work still includes evaluated skill tuning, improved route search,
personality behavior, seeded assignment generation, fleet lifecycle/rendering,
and versioned complete fleet saves. Config serialization plus existing command
replay are foundations, not a complete fleet save/restore system. No runtime
performance target for eight boats is claimed.

Product decisions remain the final visibility/precision rules, permitted motion
and shift anticipation, skill assignment distribution, and Side Specialist
signal/commitment exceptions. These do not block the opt-in foundation.
