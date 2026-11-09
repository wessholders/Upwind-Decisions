import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTrainer } from '../src/race-controller.js';
import { createFleetDescriptor, instantiateFleet, advanceFleet, raceStandings, raceEntrants } from '../src/engine/race-fleet.js';
import { createLiveComputer, advanceLiveComputer } from '../src/engine/live-computer.js';
import { replay } from '../src/engine/race.js';
import { initialBoat } from '../src/engine/physics.js';
import { createSetup, sessionConfig } from '../src/scenario-config.js';
import { personalityPreset, VALIDATED_ELITE_SKILL } from '../src/engine/npc-personalities.js';
import { courseView } from '../src/views/course.js';
import { standingsView } from '../src/views/standings.js';

const config = { npcCount: 8, opponentMode: 'npc', courseLength: 300, seed: 42,
  current: { enabled: true, speedKnots: 0.8, directionDegrees: 90 } };
const signature = s => JSON.stringify({ boat: s.boat, commands: s.commands, npcs: s.npcs, standings: s.standings });

describe('independent seeded All-Rounder fleet', () => {
  it('supports every count, distinct colors/IDs, separated lanes and the existing weights', () => {
    for (let count = 0; count <= 8; count++) {
      const t = createTrainer({ ...config, npcCount: count, boatColor: '#855ab1' }), s = t.state;
      assert.equal(s.npcs.length, count); assert.equal(s.standings.length, count + 1);
      const rows = s.fleet.descriptor.entries;
      assert.equal(new Set(rows.map(r => r.id)).size, count);
      assert.equal(new Set(rows.map(r => r.color)).size, count);
      assert.ok(rows.every(r => r.color !== '#855ab1'));
      const positions = [s.boat.position, ...s.npcs.map(n => n.boat.position)];
      for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++)
        assert.ok(Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y) >= s.scenario.config.boatLength * 3);
      for (const n of s.npcs) {
        assert.equal(n.configuration.personalityId, 'all_rounder');
        assert.deepEqual(n.configuration.strategy.weights, personalityPreset(n.configuration.personalityProfileId).weights);
      }
      if (count) { assert.equal(s.npcs.at(-1).identity.tier, 'Elite'); assert.equal(s.npcs.at(-1).configuration.skillId, VALIDATED_ELITE_SKILL); }
    }
    const s = createTrainer(config).state;
    assert.deepEqual(new Set(s.npcs.map(n => n.identity.tier)), new Set(['Beginner', 'Intermediate', 'Advanced', 'Elite']));
    assert.equal(new Set(s.npcs.map(n => n.configuration.variation.seed)).size, 8);
    assert.equal(new Set(s.npcs.map(n => n.nextDecision)).size, 8);
  });

  it('materializes reproducible descriptors, fresh reset state and independent mutable planning objects', () => {
    const t = createTrainer(config), s = t.state, original = s.fleet.descriptor;
    assert.deepEqual(createFleetDescriptor(s.scenario.config), original);
    assert.notDeepEqual(createFleetDescriptor({ ...s.scenario.config, seed: 43 }), original);
    const other = instantiateFleet(original);
    for (const field of ['boat', 'track', 'commands', 'decisions', 'planningMemory', 'commitment', 'statistics', 'planningSchedule']) {
      assert.equal(new Set(s.npcs.map(n => n[field])).size, 8, field);
      assert.notEqual(other.npcs[0][field], s.npcs[0][field], field);
    }
    s.npcs[0].planningMemory.sentinel = { value: 7 };
    assert.ok(s.npcs.slice(1).every(n => !n.planningMemory.sentinel));
    t.togglePause(); t.tick(0.2); t.reset(s.scenario.config);
    assert.deepEqual(s.fleet.descriptor, original); assert.equal(s.phase, 'ready');
    assert.ok(s.npcs.every(n => n.boat.time === 0 && !n.commands.length && !n.planningMemory.sentinel));
  });

  it('pauses/hides the whole fleet and leaves a race intact after invalid count input', () => {
    const t = createTrainer(config), s = t.state, before = signature(s);
    t.tick(0.2); assert.equal(signature(s), before);
    t.togglePause(); t.tick(0.2, true); assert.equal(signature(s), before);
    t.tick(0.2); t.togglePause(); const paused = signature(s); t.tick(0.2); assert.equal(signature(s), paused);
    for (const npcCount of [-1, 9, 2.5, NaN, '8']) {
      assert.throws(() => t.reset({ ...config, npcCount })); assert.equal(signature(s), paused);
      assert.throws(() => sessionConfig({ ...createSetup(), ...config, npcCount }));
    }
  });

  for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) {
    it(`keeps all boat/planner/standings state identical at all playback speeds: ${courseMode}`, () => {
      let expected;
      for (const speed of [1, 4, 8, 16]) {
        const t = createTrainer({ ...config, courseMode }), s = t.state;
        s.speed = speed; t.togglePause();
        for (let i = 0; i < 512 / speed; i++) t.tick(0.125);
        assert.equal(s.raceTime, 64);
        if (expected) assert.equal(signature(s), expected); else expected = signature(s);
        for (const n of s.npcs) {
          assert.deepEqual(replay(s.scenario, n.commands, n.boat.time, n.initialBoat).finish, n.boat);
          assert.ok(n.statistics.decisions > 0);
        }
        // Some boats may legitimately hold the same tack early in a long leg.
        assert.ok(new Set(s.npcs.map(n => JSON.stringify(n.commands))).size > 1);
      }
    });
  }

  it('uses the exact same environment and physics for standalone, fleet and player command replay', () => {
    const t = createTrainer(config), s = t.state;
    const standalone = instantiateFleet(s.fleet.descriptor).npcs;
    s.speed = 1; t.togglePause();
    for (let i = 0; i < 120; i++) { t.tick(0.125); if (i % 2) advanceFleet(standalone, s.scenario, 0.25); }
    assert.deepEqual(standalone, s.npcs);
    const first = s.npcs[0], unrelated = s.npcs[1].boat;
    advanceLiveComputer(first, s.scenario, 0.25); assert.equal(s.npcs[1].boat, unrelated);
  });

  it('preserves legacy single-NPC operation and keeps solo boats dormant', () => {
    const t = createTrainer({ ...config, npcCount: undefined }), s = t.state;
    const legacy = createLiveComputer();
    s.speed = 1; t.togglePause();
    for (let i = 0; i < 120; i++) { t.tick(0.125); if (i % 2) advanceLiveComputer(legacy, s.scenario, 0.25); }
    assert.deepEqual(s.computer, legacy); assert.equal(s.npcs[0], s.computer);
    const solo = createTrainer({ ...config, opponentMode: 'solo' }); solo.togglePause(); solo.tick(0.2);
    assert.equal(solo.state.npcs.length, 0); assert.equal(solo.state.computer.boat.time, 0);
  });

  it('renders nine identifiers and updates cached tracks after append/reset', () => {
    const s = createTrainer(config).state;
    const first = courseView(s); assert.equal((first.markup.match(/class="npc-boat"/g) ?? []).length, 8);
    s.npcs[0].track.push({ ...initialBoat(), position: { x: 2000, y: 2000 } });
    const extended = courseView(s); assert.match(extended.markup, /L2000.00,-2000.00/);
    assert.notEqual(extended.viewBox, first.viewBox);
    s.npcs[0].track = [s.npcs[0].boat]; assert.equal(courseView(s).viewBox, first.viewBox);
    assert.match(standingsView(s.standings), /provisional/);
    assert.match(standingsView([{ ...s.standings[0], finished: true, finishSeconds: 59.999 }]), /1:00.00/);
  });
});

describe('independent finish classification', () => {
  it('assigns places by fractional finish times, handles ties and unknown future human controllers', () => {
    const s = createTrainer(config).state, entrants = raceEntrants(s);
    entrants[0].boat = { ...s.boat, finished: true, time: 102.1 };
    entrants[1].boat = { ...s.boat, finished: true, time: 100.002 };
    entrants[2].boat = { ...s.boat, finished: true, time: 100.001 };
    entrants.push({ ...entrants[0], id: 'remote-human', control: 'network', boat: { ...s.boat, finished: true, time: 100.001 } });
    const rows = raceStandings(s.scenario, entrants);
    assert.deepEqual(rows.slice(0, 4).map(r => [r.id, r.place]), [['npc-2', 1], ['remote-human', 1], ['npc-1', 3], ['player', 4]]);
    assert.ok(rows.slice(4).every(r => r.provisional && r.place === null));
  });

  it('keeps later boats racing after the human and first NPC finish, then freezes their finish records', () => {
    const t = createTrainer(config), s = t.state;
    s.boat = { ...s.boat, finished: true, time: 100.1 }; s.phase = 'finished';
    s.npcs[0].boat = { ...s.npcs[0].boat, finished: true, time: 99.9 }; s.npcs[0].status = 'finished';
    const finished = s.npcs[0].boat;
    t.tick(0.2); assert.ok(s.npcs[7].boat.time > 0); assert.equal(s.npcs[0].boat, finished);
    const last = s.npcs[7].boat; t.togglePause(); t.tick(0.2); assert.equal(s.npcs[7].boat, last);
    t.togglePause(); t.tick(0.2); assert.ok(s.npcs[7].boat.time > last.time);
    assert.deepEqual(s.standings.filter(r => r.finished).map(r => r.finishSeconds), [99.9, 100.1]);
  });
});
