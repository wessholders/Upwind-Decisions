import { cross, direction, dot, interpolate, subtract, markContactClearance, distanceToSegment } from './geometry.js';
import { windAtPosition } from './wind.js';
import { courseRules, isUpwindFinish } from './course-config.js';
import { courseGeometry, courseCrossingFraction } from './course.js';
export const windAtMark = (scenario, time) => windAtPosition(scenario, 0, scenario.config.courseLength, time);
export function gateEnd(scenario, time) {
    if (isUpwindFinish(scenario.config)) return scenario.course.end;
    const v = direction(windAtMark(scenario, time));
    const length = scenario.config.boatLength * scenario.config.gateBoatLengths;
    return { x: v.x * length, y: scenario.config.courseLength + v.y * length };
}
// Find a crossing of the rotating finite gate during a linear integration substep.
// A sweeping gate alone cannot finish a stationary or rightward-moving boat.
export function finishFraction(scenario, from, to, startTime, dt, tack) {
    if (isUpwindFinish(scenario.config)) return courseCrossingFraction(courseGeometry(scenario), from, to, tack);
    const rules = courseRules(scenario.config);
    if (tack !== rules.requiredTack || rules.sign * (to.x - from.x) >= -1e-12)
        return null;
    const mark = { x: 0, y: scenario.config.courseLength };
    const side = (u) => rules.sign * cross(direction(windAtMark(scenario, startTime + dt * u)), subtract(interpolate(from, to, u), mark));
    let previous = side(0);
    for (let i = 1; i <= 4; i++) {
        const end = i / 4, next = side(end);
        if (previous < -1e-10 && next >= -1e-10) {
            let low = (i - 1) / 4, high = end;
            for (let j = 0; j < 35; j++) {
                const mid = (low + high) / 2;
                if (side(mid) < 0)
                    low = mid;
                else
                    high = mid;
            }
            const u = (low + high) / 2;
            const along = dot(subtract(interpolate(from, to, u), mark), direction(windAtMark(scenario, startTime + dt * u)));
            const length = scenario.config.boatLength * scenario.config.gateBoatLengths;
            if (along >= -1e-7 && along <= length + 1e-7) {
                const passDistance = distanceToSegment(mark, from, interpolate(from, to, u));
                // Check the course actually sailed, ending at the crossing.
                // Extending its line backward can invent a buoy contact after
                // the boat has already rounded safely on a curved approach.
                if (passDistance >= markContactClearance(scenario.config.boatLength) - 1e-7) return u;
            }
        }
        previous = next;
    }
    return null;
}
