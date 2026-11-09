import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createTrainer } from '../src/race-controller.js';
import { fleetIsActive } from '../src/engine/race-fleet.js';
import { replay } from '../src/engine/race.js';
import { BENCHMARK_WEATHER } from './npc-benchmark.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const races = [];
for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) for (const weather of BENCHMARK_WEATHER) {
  let expected;
  for (const speed of [1, 4, 8, 16]) {
    const t = createTrainer({ courseLength: 300, courseMode, ...weather.config, opponentMode: 'npc', npcCount: 8 }), s = t.state;
    s.speed = speed; t.togglePause(); const start = performance.now();
    while (fleetIsActive(s) && s.raceTime < 1200) t.tick(0.125);
    const cpuMilliseconds = performance.now() - start;
    const digest = hash(s.npcs);
    if (expected) assert.equal(digest, expected, `${courseMode}/${weather.id}/${speed}`);
    expected = digest;
    const npcs = s.npcs.map(n => ({ id: n.identity.id, tier: n.identity.tier, skillId: n.configuration.skillId,
      finished: n.boat.finished, finishSeconds: n.boat.finished ? n.boat.time : null,
      tacks: n.boat.tacks, commands: n.commands.length, commandDigest: hash(n.commands), ...n.statistics }));
    const commandHistories = new Set(npcs.map(n => n.commandDigest)).size;
    // Replay every offset start through the same unmodified physics.
    if (speed === 1) for (const n of s.npcs)
      assert.deepEqual(replay(s.scenario, n.commands, n.boat.time + (n.boat.finished ? 1 : 0), n.initialBoat).finish, n.boat);
    races.push({ courseMode, weather: weather.id, speed, cpuMilliseconds, digest, commandHistories,
      configuration: s.scenario.config, descriptor: s.fleet.descriptor, npcs,
      npcPlacements: s.standings.filter(r => r.role === 'npc').map(r => ({ id: r.id, place: r.place, finishSeconds: r.finishSeconds })) });
  }
  console.log(JSON.stringify({ courseMode, weather: weather.id, finishes: races.at(-1).npcs.filter(n => n.finished).length,
    commandHistories: races.at(-1).commandHistories, milliseconds: races.at(-1).cpuMilliseconds }));
}
const report = { runtime: process.version, cpuModel: cpus()[0].model, notes: 'Actual eight-NPC fleet, shared environment; no rendering. 18 environments at all four speeds. Digests cover complete frozen boat/controller/planning histories. Human holds initial heading; NPCs continue independently.',
  summary: { fleetRaces: races.length, npcStarts: races.length * 8, finishes: races.flatMap(r => r.npcs).filter(n => n.finished).length,
    distinctHistoriesMin: Math.min(...races.map(r => r.commandHistories)), deterministicCases: races.length / 4,
    totalCpuMilliseconds: races.reduce((sum, r) => sum + r.cpuMilliseconds, 0) }, weather: BENCHMARK_WEATHER, races };
await writeFile(new URL('../docs/NPC_PHASE_4_BENCHMARK.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
assert.equal(report.summary.finishes, report.summary.npcStarts, 'All fixture NPCs must finish');
assert.equal(report.summary.distinctHistoriesMin, 8, 'Every full-race command history must differ');
