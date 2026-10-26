import { STEP } from './config';
import { advance, applyAction, initialBoat } from './physics';
import type { Boat, Command, Route, Scenario } from './types';

export function replay(scenario: Scenario, commands: Command[], until: number): Route {
  let boat = initialBoat();
  const points: Boat[] = [boat];
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
