import { DEFAULT_CONFIG, validateConfig, KNOT_TO_MPS } from './config.js';
import { fieldForScenario, attachWindField } from '../wind/field.js';
import { windVector } from '../wind/config.js';
import { courseSettings, isUpwindFinish, fixedUpwindFinish } from './course-config.js';
// Mulberry32: all randomness is consumed when creating the scenario, never by a frame.
export function randomFromSeed(seed) {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6D2B79F5) >>> 0;
        let t = Math.imul(value ^ (value >>> 15), 1 | value);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function createScenario(config) {
    config = courseSettings({ ...DEFAULT_CONFIG, ...config });
    validateConfig(config);
    const random = randomFromSeed(config.seed);
    const wind = [{ time: 0, direction: 0 }];
    if (config.windMode === 'persistent' && config.windField === 'traveling') {
        wind.push({ time: config.shiftStartTime, direction: 0 }, {
            time: config.shiftStartTime + config.transitionWidth / config.propagationSpeed,
            direction: config.persistentShiftAngle,
        });
    }
    else if (config.windMode === 'persistent') {
        const start = 15 + random() * 90;
        const magnitude = config.maxShift * (0.6 + random() * 0.4) * (random() < 0.5 ? -1 : 1);
        wind.push({ time: start, direction: 0 }, { time: start + config.shiftDuration * (0.7 + random() * 0.6), direction: magnitude });
    }
    else if (config.windMode === 'oscillating') {
        const factor = { easy: 1.6, medium: 1, hard: 0.45 }[config.difficulty];
        // Cover even long, slow races. Outside this horizon the last direction is held.
        let time = 0;
        let last = 0;
        while (time < 18000) {
            time += (15 + random() * 50) * factor;
            wind.push({ time, direction: last });
            const uniformDuration = config.shiftDuration * factor * (0.65 + random() * 0.7);
            time += config.windField === 'traveling' ? config.transitionWidth / config.propagationSpeed : uniformDuration;
            last = (random() * 2 - 1) * config.maxShift;
            wind.push({ time, direction: last });
        }
    }
    const scenario = { config: { ...config }, wind };
    if (isUpwindFinish(config)) scenario.course = fixedUpwindFinish(wind[0].direction);
    return config.windField === 'organic' ? attachWindField(scenario, {
        width: Math.max(720, config.courseLength * 1.4),
        height: config.courseLength + config.boatLength * config.gateBoatLengths + 100,
        boatLength: config.boatLength, favoredSide: config.favoredSide,
        probability: config.windBias / 100, frequency: config.windFrequency,
        sizeBL: config.windSizeBL, maxShift: config.maxShift,
        windKnots: config.backgroundWindKnots, contrast: config.windContrast / 100,
        tempo: { easy: 1.6, medium: 1, hard: 0.45 }[config.difficulty],
        transitionSeconds: config.shiftDuration,
    }) : scenario;
}

// Horizontal fronts advect along negative course Y. This is a training model,
// not transport by the instantaneous wind vector or the boat's velocity.
export const windEntryHeight = scenario => scenario.config.courseLength + scenario.config.boatLength * scenario.config.gateBoatLengths;

export function windSourceTime(scenario, y, time) {
    return scenario.config.windField === 'traveling'
        ? time - (windEntryHeight(scenario) - y) / scenario.config.propagationSpeed
        : time;
}

/** Local true-wind FROM direction in course-relative degrees. */
export function windAtPosition(scenario, x, y, time) {
    if (scenario.organicWind) {
        const angle = fieldForScenario(scenario).sample(x, y, Math.max(0, time)).direction;
        return angle > 180 ? angle - 360 : angle;
    }
    return windAt(scenario, windSourceTime(scenario, y, time));
}

/** Full local wind sample used by instruments and pressure-aware sailing. */
export function windSampleAtPosition(scenario, x, y, time) {
    if (scenario.organicWind) return fieldForScenario(scenario).sample(x, y, Math.max(0, time));
    const angle = windAtPosition(scenario, x, y, time);
    const speedKnots = scenario.config.backgroundWindKnots ?? 10;
    return { direction: (angle % 360 + 360) % 360, speedKnots,
        ...windVector(angle, speedKnots), kind: 'background', influence: 0 };
}

// Limit integration only near a gradient. Outside fronts keep the normal step.
// The bound on source-time rate includes motion into or out of a region.
export function windIntegrationStep(scenario, y, time, maximum, speed, x = 0) {
    if (scenario.organicWind) {
        let step = maximum;
        const field = fieldForScenario(scenario);
        for (const p of field.featuresAt(Math.max(0, time))) {
            const relativeSpeed = speed + p.feature.speedKnots * KNOT_TO_MPS * field.config.translation;
            if (Math.hypot(x - p.x, y - p.y) > p.shape.bound + relativeSpeed * maximum) continue;
            const shoulder = Math.min(p.shape.rx, p.shape.ry) * 0.78 * 0.62;
            step = Math.min(step, shoulder / (16 * Math.max(0.01, relativeSpeed)));
        }
        return step;
    }
    if (scenario.config.windField !== 'traveling') return maximum;
    const sourceTime = windSourceTime(scenario, y, time);
    const rate = 1 + speed / scenario.config.propagationSpeed;
    const lowTime = sourceTime - rate * maximum;
    const highTime = sourceTime + rate * maximum;
    const knots = scenario.wind;
    let low = 0, high = knots.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (knots[mid].time <= lowTime) low = mid;
        else high = mid - 1;
    }
    let step = maximum;
    for (let i = low; i < knots.length - 1 && knots[i].time <= highTime; i++) {
        const a = knots[i], b = knots[i + 1];
        if (b.time >= lowTime && b.direction !== a.direction && b.time > a.time)
            step = Math.min(step, (b.time - a.time) / (16 * rate));
    }
    return step;
}
export function windAt(scenario, time) {
    const knots = scenario.wind;
    let low = 0, high = knots.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (knots[mid].time <= time)
            low = mid;
        else
            high = mid - 1;
    }
    const a = knots[low], b = knots[low + 1];
    if (!b || time <= a.time)
        return a.direction;
    const u = (time - a.time) / (b.time - a.time);
    const smooth = u * u * (3 - 2 * u);
    return a.direction + (b.direction - a.direction) * smooth;
}
