import { KNOT_TO_MPS } from './config.js';
import { direction, dot, radians, subtract } from './geometry.js';
import { advance, applyAction, initialBoat } from './physics.js';
import { replay } from './race.js';
import { windAtPosition } from './wind.js';
// Ranking only: a frozen-current-wind travel estimate. It is NOT an admissible
// bound for changing wind, and no optimality claim is made from this heuristic.
function rank(boat, scenario) {
    const wind = windAtPosition(scenario, boat.position.x, boat.position.y, boat.time);
    const remaining = subtract({ x: 0, y: scenario.config.courseLength + 1 }, boat.position);
    const v = direction(wind);
    const up = dot(remaining, v);
    const across = Math.abs(dot(remaining, { x: v.y, y: -v.x }));
    const angle = radians(scenario.config.minAngle);
    const speed = scenario.config.speedKnots * KNOT_TO_MPS;
    const sailing = Math.max(Math.hypot(remaining.x, remaining.y), up / Math.cos(angle), across / Math.sin(angle)) / speed;
    return sailing + boat.penaltyRemaining + (boat.tack === 'port' ? scenario.config.tackPenalty : 0);
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
    const speed = scenario.config.speedKnots * KNOT_TO_MPS;
    const horizon = options.horizon ?? scenario.config.courseLength / (speed * Math.cos(radians(scenario.config.minAngle))) * 2.5 + 180;
    while (beam.length && beam[0].boat.time < Math.min(horizon, best?.finish.time ?? Infinity)) {
        const cells = new Map();
        for (const parent of beam) {
            const actions = parent.boat.penaltyRemaining > 0 ? ['hold'] : ['hold', 'tack', parent.boat.mode === 'close' ? 'bear' : 'close'];
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
                const key = `${Math.round(boat.position.x / options.cell)},${Math.round(boat.position.y / options.cell)},${boat.tack},${boat.mode},${boat.penaltyRemaining.toFixed(2)}`;
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
export function optimize(scenario, playerCommands, playerTime) {
    // Including the completed player route guarantees a valid known route isn't
    // hidden by beam pruning. It does not alter the physics or search constraints.
    let incumbent = null;
    if (playerCommands && playerTime !== undefined) {
        const player = replay(scenario, playerCommands, playerTime + 1);
        if (player.finish.finished)
            incumbent = player;
    }
    const coarse = search(scenario, { interval: 4, width: 100, cell: 4 }, initialBoat(), [], incumbent);
    const settings = { interval: 2, width: 140, cell: 2 };
    const fine = search(scenario, settings, initialBoat(), [], coarse.route);
    const route = fine.route;
    const comparisons = [];
    let expanded = coarse.expanded + fine.expanded;
    if (route) {
        for (const tack of route.commands.filter(c => c.action === 'tack').slice(0, 8)) {
            const prefix = route.commands.filter(c => c.time < tack.time - 1e-8);
            const atDecision = replay(scenario, prefix, tack.time).finish;
            const delayed = advance(atDecision, scenario, settings.interval);
            const alternative = search(scenario, { ...settings, width: 70, horizon: route.finish.time + 120 }, delayed, prefix);
            expanded += alternative.expanded;
            comparisons.push({ time: tack.time, continuedTime: alternative.route?.finish.time ?? null, chosenTime: route.finish.time, delay: settings.interval });
        }
    }
    return { route, comparisons, settings, expanded, label: 'Best route found · hindsight benchmark' };
}
