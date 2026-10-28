import { KNOT_TO_MPS } from './config.js';
import { direction, dot, radians, subtract } from './geometry.js';
import { advance, applyAction, initialBoat, targetSpeedKnots } from './physics.js';
import { recoveryRemaining, tackSpeedCost } from './tack.js';
import { replay } from './race.js';
import { windAtPosition } from './wind.js';
import { referenceSpeedKnots } from './performance.js';
import { courseGeometry, nearestFinishPoint } from './course.js';
import { courseRules, isUpwindFinish } from './course-config.js';
import { describeTack, stateBeforeCommand, TACK_COMPARISON_DELAY, MAX_FINISH_COMPARISONS } from './tack-analysis.js';
// Ranking only: a frozen-current-wind travel estimate. It is NOT an admissible
// bound for changing wind, and no optimality claim is made from this heuristic.
function rank(boat, scenario) {
    const wind = windAtPosition(scenario, boat.position.x, boat.position.y, boat.time);
    const course = courseGeometry(scenario, boat.time);
    const goal = isUpwindFinish(scenario.config) ? nearestFinishPoint(boat.position, course) : { x: 0, y: scenario.config.courseLength + 1 };
    const remaining = subtract(goal, boat.position);
    const v = direction(wind);
    const up = dot(remaining, v);
    const across = Math.abs(dot(remaining, { x: v.y, y: -v.x }));
    const angle = radians(scenario.config.minAngle);
    const speed = Math.max(1e-6, targetSpeedKnots(boat, scenario)) * KNOT_TO_MPS;
    const sailing = Math.max(Math.hypot(remaining.x, remaining.y), up / Math.cos(angle), across / Math.sin(angle)) / speed;
    const required = courseRules(scenario.config).requiredTack;
    return sailing + (required && boat.tack !== required ? tackSpeedCost(scenario.config) : 0);
}
function commandsFrom(node) {
    const commands = [];
    for (let cursor = node; cursor; cursor = cursor.parent)
        if (cursor.command)
            commands.push(cursor.command);
    return commands.reverse();
}
export function search(scenario, options, start = initialBoat(), prefix = [], incumbent = null) {
    let beam = [{ boat: start, parent: null, command: null }];
    let best = incumbent;
    let expanded = 0;
    const speed = referenceSpeedKnots(scenario.config) * KNOT_TO_MPS;
    const horizon = options.horizon ?? scenario.config.courseLength / (speed * Math.cos(radians(scenario.config.minAngle))) * 2.5 + 180;
    while (beam.length && beam[0].boat.time < Math.min(horizon, best?.finish.time ?? Infinity)) {
        const cells = new Map();
        for (const parent of beam) {
            const actions = parent.boat.penaltyRemaining > 1e-9 ? ['hold']
                : ['hold', ...(recoveryRemaining(parent.boat.tackManeuver, parent.boat.time) > 1e-9 ? [] : ['tack']), parent.boat.mode === 'close' ? 'bear' : 'close'];
            for (const action of actions) {
                const acted = applyAction(parent.boat, action, scenario);
                const boat = advance(acted, scenario, options.interval);
                expanded++;
                const node = { boat, parent, command: action === 'hold' ? null : { time: parent.boat.time, action } };
                if (boat.finished) {
                    if (!best || boat.time < best.finish.time - 1e-7 || (Math.abs(boat.time - best.finish.time) < 1e-7 && boat.distance < best.finish.distance)) {
                        // Replaying the command log through the same engine is authoritative.
                        const candidate = replay(scenario, [...prefix, ...commandsFrom(node)], boat.time + 1);
                        if (candidate.finish.finished)
                            best = candidate;
                    }
                    continue;
                }
                const phase = boat.tackManeuver ? `${(boat.time - boat.tackManeuver.start).toFixed(2)},${boat.tackManeuver.entryOffset.toFixed(1)},${boat.tackManeuver.entrySpeed.toFixed(2)}` : '-';
                const key = `${Math.round(boat.position.x / options.cell)},${Math.round(boat.position.y / options.cell)},${boat.tack},${boat.mode},${boat.speedKnots?.toFixed(1)},${phase}`;
                const score = rank(boat, scenario);
                const previous = cells.get(key);
                if (!previous || score < previous.score - 1e-8 || (Math.abs(score - previous.score) < 1e-8 && boat.distance < previous.node.boat.distance))
                    cells.set(key, { node, score });
            }
        }
        beam = [...cells.values()].sort((a, b) => a.score - b.score || a.node.boat.distance - b.node.boat.distance).slice(0, options.width).map(entry => entry.node);
    }
    return { route: best, expanded };
}
export function optimize(scenario, playerCommands, playerTime, additionalRoutes = []) {
    // Including the completed player route guarantees a valid known route isn't
    // hidden by beam pruning. It does not alter the physics or search constraints.
    let incumbent = null;
    const known = [...additionalRoutes];
    if (playerCommands && playerTime !== undefined) known.push({ commands: playerCommands, time: playerTime });
    for (const candidate of known) {
        const route = replay(scenario, candidate.commands, candidate.time + 1);
        if (route.finish.finished && (!incumbent || route.finish.time < incumbent.finish.time)) incumbent = route;
    }
    const coarse = search(scenario, { interval: 4, width: 100, cell: 4 }, initialBoat(), [], incumbent);
    const settings = { interval: 2, width: 140, cell: 2, comparisonDelay: TACK_COMPARISON_DELAY };
    const fine = search(scenario, settings, initialBoat(), [], coarse.route);
    const route = fine.route;
    const comparisons = [];
    let expanded = coarse.expanded + fine.expanded;
    if (route) {
        for (const [index, command] of route.commands.entries()) {
            if (command.action !== 'tack') continue;
            const decision = stateBeforeCommand(scenario, route, index);
            const checked = comparisons.length < MAX_FINISH_COMPARISONS;
            let alternative = null;
            if (checked) {
                const delayed = advance(decision.boat, scenario, TACK_COMPARISON_DELAY);
                // If holding already finishes, that is a valid alternative.
                // Otherwise preserve the identical prefix and replan after 10 s.
                if (delayed.finished) alternative = replay(scenario, decision.prefix, delayed.time + 1);
                else {
                    const result = search(scenario, { ...settings, width: 70, horizon: route.finish.time + 120 }, delayed, decision.prefix);
                    expanded += result.expanded;
                    alternative = result.route;
                }
            }
            comparisons.push(describeTack(scenario, route, index, comparisons.length + 1, decision, {
                checked, continuedTime: alternative?.finish.time ?? null, delay: TACK_COMPARISON_DELAY,
            }));
        }
    }
    return { route, comparisons, settings, expanded, label: 'Best route found · hindsight benchmark' };
}
