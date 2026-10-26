import { STEP } from './config.js';
import { advance, applyAction, initialBoat } from './physics.js';
export function replay(scenario, commands, until) {
    let boat = initialBoat();
    const points = [boat];
    let index = 0;
    while (boat.time < until - 1e-8 && !boat.finished) {
        while (index < commands.length && commands[index].time <= boat.time + 1e-8) {
            boat = applyAction(boat, commands[index++].action, scenario);
        }
        const nextCommand = commands[index]?.time ?? Infinity;
        const dt = Math.min(STEP, until - boat.time, nextCommand - boat.time);
        boat = advance(boat, scenario, dt);
        points.push(boat);
    }
    return { commands, points, finish: boat };
}
