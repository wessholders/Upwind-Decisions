import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTrainer } from '../src/race-controller.js';
import { DEFAULT_CONFIG } from '../src/engine/config.js';
import { applyAction, initialBoat, sailingHeading, advance } from '../src/engine/physics.js';
import { createScenario, windAtPosition } from '../src/engine/wind.js';
import { replay } from '../src/engine/race.js';
import { createSetup, selectPreset, sessionConfig, WIND_PRESETS } from '../src/scenario-config.js';
import { fieldForScenario } from '../src/wind/field.js';
import { bindSailingKeyboard, steeringDelta } from '../src/keyboard.js';
import { loadPreferences, savePreferences } from '../src/preferences.js';

describe('game scenario boundary', () => {
  it('keeps the draft separate, preserves settings, and rejects invalid current', () => {
    const draft = createSetup(); draft.windContrast = 55;
    const before = structuredClone(draft), config = sessionConfig(draft);
    assert.deepEqual(draft, before); assert.equal(config.windContrast, 55);
    assert.deepEqual(config, sessionConfig(draft));
    assert.throws(() => sessionConfig({ ...draft, randomize: false, current: { enabled: true, speedKnots: 4, directionDegrees: 0 } }), /Current requires/);
    assert.throws(() => sessionConfig({ ...draft, seed: 1.5 }), /integer/);
  });
  it('maps all presets through existing generators with seeded persistent direction', () => {
    for (const id of Object.keys(WIND_PRESETS)) for (const seed of [0, 8, 314159]) {
      const draft = { ...selectPreset(createSetup(), id), seed };
      const a = createScenario(sessionConfig(draft)), b = createScenario(sessionConfig(draft));
      assert.deepEqual(a, b);
      const f = fieldForScenario(a), g = fieldForScenario(b);
      for (const time of [0, 200, 600]) assert.deepEqual(f.sample(0, 500, time), g.sample(0, 500, time));
      if (id === 'left' || id === 'right') {
        assert.equal(Math.sign(f.scenario.background(2000)), id === 'left' ? -1 : 1);
        for (const windField of ['uniform', 'traveling']) {
          const s = createScenario(sessionConfig({ ...draft, windField }));
          assert.equal(Math.sign(s.wind.at(-1).direction), id === 'left' ? -1 : 1);
        }
      }
    }
  });
  it('disables solo NPC ticks and resets exactly one existing NPC on restart', () => {
    for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) for (const opponentMode of ['solo', 'npc']) for (const speed of [1, 4, 8, 16]) {
      const trainer = createTrainer(sessionConfig({ ...createSetup(), courseMode, opponentMode }));
      trainer.state.speed = speed;
      trainer.togglePause(); trainer.tick(.2); trainer.tick(.2);
      assert.equal(trainer.state.computer.boat.time > 0, opponentMode === 'npc');
      const scenario = structuredClone(trainer.state.scenario);
      trainer.state.showReference = true;
      trainer.reset(trainer.state.scenario.config);
      assert.equal(trainer.state.showReference, false);
      assert.equal(trainer.state.computer.boat.time, 0); assert.equal(trainer.state.boat.time, 0);
      assert.deepEqual(trainer.state.scenario, scenario);
    }
  });
});

describe('real-time wind-relative steering', () => {
  it('moves the target 7.5 degrees over half a real second at every multiplier', () => {
    for (const speed of [1, 4, 8, 16]) {
      const t = createTrainer({ ...DEFAULT_CONFIG, windMode: 'steady', opponentMode: 'solo' });
      t.state.speed = speed; t.togglePause();
      for (let i = 0; i < 30; i++) { t.steer(steeringDelta(-1, 1 / 60)); t.tick(1 / 60); }
      assert.ok(Math.abs(t.state.boat.targetAngle - 52.5) < 1e-9);
      const angle = t.state.boat.targetAngle; t.tick(.1); assert.equal(t.state.boat.targetAngle, angle);
      const played = replay(t.state.scenario, t.state.commands, t.state.boat.time).finish;
      assert.deepEqual(played, t.state.boat);
    }
    assert.equal(steeringDelta(1, 50), 1.5);
  });
  it('uses physical left/right on both tacks, clamps at the profile bounds and never tacks', () => {
    const t = createTrainer({ ...DEFAULT_CONFIG, windMode: 'steady', opponentMode: 'solo' }); t.togglePause();
    t.steer(-10); assert.equal(t.state.boat.targetAngle, 55);
    t.steer(1000); assert.equal(t.state.boat.targetAngle, 45); assert.equal(t.state.boat.tack, 'starboard');
    t.steer(-1000); assert.equal(t.state.boat.targetAngle, 175);
    t.state.boat = { ...initialBoat(), tack: 'port' }; t.steer(10); assert.equal(t.state.boat.targetAngle, 55);
    t.steer(-1000); assert.equal(t.state.boat.targetAngle, 45); assert.equal(t.state.boat.tacks, 0);
  });
  it('tracks actual local wind without adding penalties and retains the authoritative tack transition', () => {
    const s = createScenario({ ...DEFAULT_CONFIG, windMode: 'persistent', windField: 'traveling', shiftStartTime: 0 });
    let boat = applyAction(initialBoat(), { type: 'steer', angle: 52 }, s);
    for (const time of [0, 100, 500]) {
      const state = { ...boat, time, position: { x: 30, y: 800 } };
      assert.equal(sailingHeading(state, s) - windAtPosition(s, 30, 800, time), -52);
    }
    boat = applyAction(boat, 'tack', s); assert.equal(boat.tacks, 1); assert.equal(boat.mode, 'close');
    assert.ok(boat.tackManeuver); assert.equal(applyAction(boat, { type: 'steer', angle: 60 }, s), boat);
    boat = advance(boat, s, 8); assert.equal(boat.penaltyTime, 4.5);
  });
  it('manual input cancels mark aiming and close haul cancels manual steering', () => {
    const s = createScenario(DEFAULT_CONFIG);
    let b = applyAction(initialBoat(), 'bear', s); assert.equal(b.mode, 'gate');
    b = applyAction(b, { type: 'steer', angle: 50 }, s); assert.equal(b.mode, 'manual');
    b = applyAction(b, 'close', s); assert.equal(b.mode, 'close'); assert.equal(sailingHeading(b, s), -45);
  });
});

describe('keyboard lifecycle and local preferences', () => {
  it('suppresses browser scrolling for space and every arrow, including repeat events', () => {
    const target = new EventTarget(), documentTarget = new EventTarget();
    const controls = bindSailingKeyboard({ target, documentTarget, enabled: () => true, steer() {}, tack() {}, pause() {}, menu() {} });
    for (const code of ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) for (const repeat of [false, true]) {
      const event = new Event('keydown', { cancelable: true }); Object.assign(event, { code, repeat });
      target.dispatchEvent(event); assert.equal(event.defaultPrevented, true, `${code}, repeat=${repeat}`);
    }
    controls.destroy();
  });
  it('tracks held keys, ignores repeats/forms and clears on blur, hide, and disposal', () => {
    const target = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
    let delta = 0, tacks = 0, active = true;
    const key = (type, code, extra = {}) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { code, repeat: false }, extra); target.dispatchEvent(e); };
    const controls = bindSailingKeyboard({ target, documentTarget: doc, enabled: () => active, steer: d => { delta += d; }, tack: () => tacks++, pause() {}, menu() {} });
    key('keydown', 'ArrowRight'); controls.tick(.1); assert.equal(delta, 1.5);
    key('keyup', 'ArrowRight'); controls.tick(.1); assert.equal(delta, 1.5);
    key('keydown', 'Space'); key('keydown', 'Space', { repeat: true }); assert.equal(tacks, 1);
    key('keyup', 'Space'); key('keydown', 'Space'); assert.equal(tacks, 2);
    key('keydown', 'ArrowRight'); target.dispatchEvent(new Event('blur')); controls.tick(.1); assert.equal(delta, 1.5);
    key('keydown', 'ArrowRight'); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); doc.hidden = false; controls.tick(.1); assert.equal(delta, 1.5);
    key('keydown', 'ArrowLeft'); active = false; controls.tick(.1); active = true; controls.tick(.1); assert.equal(delta, 1.5);
    target.closest = () => true;
    key('keydown', 'ArrowRight'); controls.tick(.1); assert.equal(delta, 1.5, 'Form inputs must keep native keys.');
    target.closest = () => null;
    key('keydown', 'ArrowRight'); target.closest = () => true; target.dispatchEvent(new Event('focusin'));
    target.closest = () => null; controls.tick(.1); assert.equal(delta, 1.5);
    controls.destroy(); key('keyup', 'Space'); key('keydown', 'Space'); assert.equal(tacks, 2);
  });
  it('validates persisted colors and works when storage is blocked', () => {
    const storage = { value: '', getItem() { return this.value; }, setItem(k, v) { this.value = v; } };
    const prefs = loadPreferences(storage); prefs.boatColor = '#26766e'; assert.ok(savePreferences(storage, prefs));
    assert.deepEqual(loadPreferences(storage), prefs);
    storage.value = '{broken'; assert.equal(loadPreferences(storage).boatColor, '#246caa');
    assert.equal(savePreferences({ setItem() { throw Error(); } }, prefs), false);
  });
});
