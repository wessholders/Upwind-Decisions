import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createTrainer } from '../src/race-controller.js';
import { createScenario } from '../src/engine/wind.js';
import { initialBoat } from '../src/engine/physics.js';
import { observeCurrentWind, observeRoutePlanner } from '../src/engine/npc-observation.js';
import { createNpcConfiguration } from '../src/engine/npc-config.js';
import { evaluateNpcPolicy } from '../src/engine/npc-policy.js';

const current = (speedKnots, directionDegrees) => ({ enabled: true, speedKnots, directionDegrees });
export const BENCHMARK_WEATHER = [
  { id: 'steady', config: { windField: 'uniform', windMode: 'steady', backgroundWindKnots: 10, seed: 314159 } },
  { id: 'light-following', config: { windField: 'uniform', windMode: 'steady', backgroundWindKnots: 6, current: current(0.6, 0), seed: 42 } },
  { id: 'strong-adverse', config: { windField: 'uniform', windMode: 'steady', backgroundWindKnots: 18, current: current(0.8, 180), seed: 73 } },
  { id: 'puffs-cross', config: { windField: 'organic', windMode: 'oscillating', windContrast: 60,
    windFrequency: 3, windSizeBL: 20, current: current(1.2, 90), seed: 42 } },
  { id: 'persistent-oblique', config: { windField: 'organic', windMode: 'persistent', backgroundWindKnots: 14,
    favoredSide: 'left', shiftDirection: -1, maxShift: 20, current: current(1, 225), seed: 314159 } },
  { id: 'traveling-cross', config: { windField: 'traveling', windMode: 'oscillating', maxShift: 20,
    shiftDuration: 20, current: current(0.8, 270), seed: 73 } },
];
const COURSE_MODES = ['round-port', 'round-starboard', 'finish-upwind'];
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];

export function runBenchmarkRace(scenarioConfig, npcConfig, speed = 1, limitSeconds = 1200) {
  const trainer = createTrainer({ courseLength: 300, opponentMode: 'npc', ...scenarioConfig }, npcConfig);
  const s = trainer.state; s.speed = speed; trainer.togglePause();
  const start = performance.now();
  while (!s.computer.boat.finished && s.computer.status !== 'timed-out' && s.raceTime < limitSeconds)
    trainer.tick(0.125);
  const cpuMilliseconds = performance.now() - start, n = s.computer, b = n.boat;
  const digest = createHash('sha256').update(JSON.stringify({ boat: b, commands: n.commands, memory: n.planningMemory })).digest('hex');
  return { policyId: n.configuration.policyId, skillId: n.configuration.skillId, speed,
    npcConfiguration: n.configuration, realizedScenarioConfig: s.scenario.config,
    finished: b.finished, finishSeconds: b.finished ? b.time : null,
    timedOut: !b.finished, timeoutReason: b.finished ? null : n.status === 'timed-out' ? 'engine-limit' : 'harness-limit',
    simulatedSeconds: b.time, tacks: b.tacks, distanceMeters: b.distance,
    decisions: n.statistics.decisions, candidates: n.statistics.candidates, forecastSteps: n.statistics.forecastSteps,
    budgetExhaustions: n.statistics.budgetExhaustions, cpuMilliseconds, digest };
}

export function measureDecisions(repetitions = 20) {
  const measurements = [];
  for (const weather of [BENCHMARK_WEATHER[0], BENCHMARK_WEATHER[3]]) {
    for (const skillId of [null, 'beginner', 'intermediate', 'advanced']) {
      const route = skillId !== null;
      const configuration = createNpcConfiguration(route ? { policyId: 'route-planner-v2', skillId } : {});
      const scenario = createScenario({ courseLength: 1000, ...weather.config });
      const boat = { ...initialBoat(), time: 60, position: { x: -100, y: 150 } };
      const policyTimes = [], observationTimes = [], totalTimes = [], counts = [], steps = [];
      for (let i = -3; i < repetitions; i++) {
        const start = performance.now();
        const observation = route ? observeRoutePlanner(scenario, boat, configuration.observationProfileId)
          : observeCurrentWind(scenario, boat, configuration.observationProfileId);
        const observed = performance.now();
        const choice = evaluateNpcPolicy({ configuration, observation });
        const end = performance.now();
        if (i < 0) continue;
        observationTimes.push(observed - start); policyTimes.push(end - observed); totalTimes.push(end - start);
        counts.push(choice.diagnostics?.candidateCount ?? choice.options.length);
        if (route) steps.push(choice.diagnostics.forecastSteps);
      }
      const interval = configuration.planning?.decisionIntervalSeconds ?? 2;
      const medianTotalMilliseconds = percentile(totalTimes, 0.5);
      measurements.push({ weather: weather.id, policyId: configuration.policyId, skillId,
        repetitions, medianObservationMilliseconds: percentile(observationTimes, 0.5),
        medianPolicyMilliseconds: percentile(policyTimes, 0.5), medianTotalMilliseconds,
        p95TotalMilliseconds: percentile(totalTimes, 0.95),
        candidateRange: [Math.min(...counts), Math.max(...counts)],
        forecastStepRange: route ? [Math.min(...steps), Math.max(...steps)] : null,
        projectedEightNpc: [1, 4, 8, 16].map(speed => ({ speed, evaluationsPerWallSecond: 8 * speed / interval,
          cpuMillisecondsPerWallSecond: medianTotalMilliseconds * 8 * speed / interval })) });
    }
  }
  return measurements;
}

export function runComparison({ speeds = [1, 4, 8, 16], limitSeconds = 1200, progress = () => {} } = {}) {
  const races = [], comparisons = [];
  for (const courseMode of COURSE_MODES) for (const weather of BENCHMARK_WEATHER) {
    const key = `${courseMode}/${weather.id}`, results = {};
    for (const policyId of ['legacy-reference', 'route-planner-v2']) {
      let digest;
      for (const speed of speeds) {
        const result = runBenchmarkRace({ ...weather.config, courseMode }, { policyId }, speed, limitSeconds);
        if (digest && result.digest !== digest) throw new Error(`Playback-dependent result: ${key}/${policyId}/${speed}`);
        digest = result.digest; races.push({ scenario: key, scenarioConfig: { ...weather.config, courseMode }, ...result });
        results[policyId] ??= result;
      }
    }
    const legacy = results['legacy-reference'], route = results['route-planner-v2'];
    const difference = legacy.finished && route.finished ? route.finishSeconds - legacy.finishSeconds : null;
    const outcome = !route.finished ? legacy.finished ? 'underperformed' : 'both-unfinished'
      : !legacy.finished ? 'outperformed' : Math.abs(difference) <= 0.5 ? 'matched' : difference < 0 ? 'outperformed' : 'underperformed';
    comparisons.push({ scenario: key, outcome, routeMinusLegacySeconds: difference,
      legacySeconds: legacy.finishSeconds, routeSeconds: route.finishSeconds });
    progress(comparisons.at(-1));
  }
  return { speeds, limitSeconds, races, comparisons,
    summary: Object.fromEntries(['outperformed', 'matched', 'underperformed', 'both-unfinished']
      .map(outcome => [outcome, comparisons.filter(c => c.outcome === outcome).length])) };
}

async function main() {
  const speedArg = process.argv.find(arg => arg.startsWith('--speeds='));
  const speeds = speedArg ? speedArg.slice(9).split(',').map(Number) : [1, 4, 8, 16];
  if (!speeds.length || speeds.some(n => ![1, 4, 8, 16].includes(n))) throw new Error('Use playback speeds 1,4,8,16.');
  const measurements = measureDecisions();
  const comparison = runComparison({ speeds, progress: result => console.log(JSON.stringify(result)) });
  const report = { runtime: process.version, platform: process.platform, architecture: process.arch,
    measurementNotes: 'Headless engine measurements; race CPU includes controller/player integration, no browser rendering. Eight-NPC costs are extrapolations, not fleet validation.',
    measurements, ...comparison };
  const outputArg = process.argv.find(arg => arg.startsWith('--output='));
  if (outputArg) {
    const destination = resolve(outputArg.slice(9));
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ summary: report.summary, races: report.races.length, measurements: report.measurements }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error); process.exitCode = 1; });
