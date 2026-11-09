import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { createScenario, windSampleAtPosition } from '../src/engine/wind.js';
import { initialBoat } from '../src/engine/physics.js';
import { createLiveComputer, advanceLiveComputer } from '../src/engine/live-computer.js';
import { createNpcConfiguration } from '../src/engine/npc-config.js';
import { NPC_PERSONALITY_PRESETS } from '../src/engine/npc-personalities.js';
import { observeRoutePlanner } from '../src/engine/npc-observation.js';
import { evaluateNpcPolicy } from '../src/engine/npc-policy.js';
import { initialSideIndicator } from '../src/engine/npc-side-indicator.js';
import { signedAngle } from '../src/engine/geometry.js';
import { createTrainer } from '../src/race-controller.js';
import { BENCHMARK_WEATHER } from './npc-benchmark.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profiles = Object.keys(NPC_PERSONALITY_PRESETS);
const skills = ['beginner', 'intermediate', 'advanced'];
const modes = ['round-port', 'round-starboard', 'finish-upwind'];
const mean = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

export function personalityRace(configuration, environmentConfig, limit = 1200) {
  const scenario = createScenario({ courseLength: 300, ...environmentConfig }), npc = createLiveComputer(configuration);
  let windIntegral = 0, liftIntegral = 0, pocketSeconds = 0, leftSeconds = 0, rightSeconds = 0;
  const start = performance.now();
  while (!npc.boat.finished && npc.status !== 'timed-out' && npc.boat.time < limit) {
    const before = npc.boat;
    advanceLiveComputer(npc, scenario, 0.25);
    const after = npc.boat, dt = after.time - before.time;
    // Offline validation telemetry only; none is fed back into policy input.
    const wind = windSampleAtPosition(scenario, (before.position.x + after.position.x) / 2,
      (before.position.y + after.position.y) / 2, before.time + dt / 2);
    windIntegral += wind.speedKnots * dt;
    liftIntegral += (after.tack === 'starboard' ? 1 : -1) * signedAngle(wind.direction) * dt;
    if (wind.speedKnots < scenario.config.backgroundWindKnots * 0.95) pocketSeconds += dt;
    if (after.position.x < 0) leftSeconds += dt; else if (after.position.x > 0) rightSeconds += dt;
  }
  const cpuMilliseconds = performance.now() - start, b = npc.boat;
  return { finished: b.finished, finishSeconds: b.finished ? b.time : null, elapsedSeconds: b.time,
    tacks: b.tacks, distanceMeters: b.distance, ...npc.statistics, cpuMilliseconds,
    meanWindKnots: windIntegral / b.time, meanLiftDegrees: liftIntegral / b.time, pocketSeconds,
    leftSeconds, rightSeconds, courseSide: npc.commitment.courseSide,
    commandDigest: hash(npc.commands), stateDigest: hash({ boat: b, commands: npc.commands, commitment: npc.commitment, memory: npc.planningMemory }),
    timeoutReason: b.finished ? null : npc.status === 'timed-out' ? 'engine-limit' : 'harness-limit' };
}

export function measurePersonalityDecisions() {
  const scenario = createScenario({ courseLength: 1000, ...BENCHMARK_WEATHER[3].config });
  const first = observeRoutePlanner(scenario, initialBoat());
  const indicator = initialSideIndicator(scenario, first);
  const o = observeRoutePlanner(scenario, { ...initialBoat(), time: 60, position: { x: -100, y: 150 } });
  return [null, ...profiles].map(profileId => {
    const c = createNpcConfiguration(profileId ? { personalityProfileId: profileId, skillId: 'advanced' } : { policyId: 'route-planner-v2' });
    const commitment = c.strategy?.commitSide ? { courseSide: { ...indicator, initializedAt: 0, locked: true } } : {};
    const times = []; let result;
    for (let i = -3; i < 20; i++) {
      const start = performance.now(); result = evaluateNpcPolicy({ configuration: c, observation: o, commitment });
      if (i >= 0) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { profileId: profileId ?? 'unweighted-phase2', medianMilliseconds: times[10], p95Milliseconds: times[19],
      candidates: result.diagnostics.candidateCount, forecastSteps: result.diagnostics.forecastSteps,
      selectedPlan: result.memory.plan?.id ?? null };
  });
}

export function verifyPersonalityClocks() {
  const results = [];
  for (const profileId of profiles) {
    let digest;
    for (const speed of [1, 4, 8, 16]) {
      const t = createTrainer({ courseLength: 300, opponentMode: 'npc', ...BENCHMARK_WEATHER[3].config },
        { personalityProfileId: profileId, skillId: 'intermediate' });
      t.state.speed = speed; t.togglePause();
      for (let i = 0; i < 512 / speed; i++) t.tick(0.125);
      const actual = hash(t.state.computer);
      if (digest && digest !== actual) throw new Error(`Playback divergence: ${profileId}/${speed}`);
      digest = actual;
    }
    results.push({ profileId, speeds: [1, 4, 8, 16], simulatedSeconds: 64, digest });
  }
  return results;
}

export function summarizePersonalities(races) {
  return profiles.flatMap(profileId => skills.map(skillId => {
    const rows = races.filter(r => r.profileId === profileId && r.skillId === skillId);
    return { profileId, skillId, races: rows.length, finishes: rows.filter(r => r.finished).length,
      meanFinishOrTimeoutSeconds: mean(rows, 'elapsedSeconds'), meanTacks: mean(rows, 'tacks'), meanWindKnots: mean(rows, 'meanWindKnots'),
      meanPocketSeconds: mean(rows, 'pocketSeconds'), meanLiftDegrees: mean(rows, 'meanLiftDegrees'),
      meanCpuMilliseconds: mean(rows, 'cpuMilliseconds'), meanDecisions: mean(rows, 'decisions'),
      budgetExhaustions: rows.reduce((sum, r) => sum + r.budgetExhaustions, 0),
      traceSignature: hash(rows.map(r => [r.caseId, r.commandDigest])) };
  }));
}

async function main() {
  const measurements = measurePersonalityDecisions(), races = [];
  for (const courseMode of modes) for (const weather of BENCHMARK_WEATHER) for (const skillId of skills) {
    for (const profileId of profiles) {
      const configuration = createNpcConfiguration({ personalityProfileId: profileId, skillId });
      races.push({ caseId: `${courseMode}/${weather.id}`, profileId, skillId,
        ...personalityRace(configuration, { courseMode, ...weather.config }) });
    }
    console.log(JSON.stringify({ caseId: `${courseMode}/${weather.id}`, skillId,
      completed: races.length, unfinished: races.filter(r => !r.finished).length }));
  }
  const summary = summarizePersonalities(races);
  const eliteValidation = summary.filter(r => r.profileId === 'elite-all-rounder').sort((a, b) =>
    b.finishes - a.finishes || a.meanFinishOrTimeoutSeconds - b.meanFinishOrTimeoutSeconds || skills.indexOf(b.skillId) - skills.indexOf(a.skillId));
  const clockChecks = verifyPersonalityClocks();
  const report = { runtime: process.version, cpuModel: cpus()[0].model,
    notes: 'Sequential independent NPCs; no active fleet. Race CPU includes validation wind telemetry; pure decision cost is measured separately.',
    weather: BENCHMARK_WEATHER, courseModes: modes, roundingCourseLength: 300, finishUpwindLength: 1000,
    profiles: NPC_PERSONALITY_PRESETS,
    scenarioConfigurations: Object.fromEntries(modes.flatMap(courseMode => BENCHMARK_WEATHER.map(weather =>
      [`${courseMode}/${weather.id}`, createScenario({ courseLength: 300, courseMode, ...weather.config }).config]))),
    npcConfigurations: Object.fromEntries(profiles.flatMap(personalityProfileId => skills.map(skillId =>
      [`${personalityProfileId}/${skillId}`, createNpcConfiguration({ personalityProfileId, skillId })]))),
    measurements, summary,
    eliteValidation: { rule: 'Most finishes, then lowest mean elapsed including capped nonfinishes; higher named skill only breaks an exact tie.',
      selectedSkill: eliteValidation[0].skillId, results: eliteValidation },
    clockChecks, races };
  const argument = process.argv.find(arg => arg.startsWith('--output='));
  if (argument) {
    const destination = resolve(argument.slice(9)); await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ races: races.length, unfinished: races.filter(r => !r.finished).length,
    eliteValidation: report.eliteValidation, distinctAdvancedTraces: new Set(summary.filter(r => r.skillId === 'advanced').map(r => r.traceSignature)).size,
    measurements }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error); process.exitCode = 1; });
