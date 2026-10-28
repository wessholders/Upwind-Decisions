import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_MODE, courseRules } from '../src/engine/course-config.js';
import { fixedUpwindFinish, courseGeometry, courseCrossingFraction, finishLaylines, finishLineBias, prevailingFinishWind, FINISH_GUIDES } from '../src/engine/course.js';
import { createScenario, windAtPosition } from '../src/engine/wind.js';
import { initialBoat, applyAction, advance, sailingHeading } from '../src/engine/physics.js';
import { finishFraction, gateEnd } from '../src/engine/finish.js';
import { dot, subtract, direction, cross } from '../src/engine/geometry.js';
import { createTrainer } from '../src/race-controller.js';
import { createLiveComputer, advanceLiveComputer } from '../src/engine/live-computer.js';
import { search } from '../src/engine/optimizer.js';
import { replay } from '../src/engine/race.js';
import { courseView } from '../src/views/course.js';
import { COURSE_THEME } from '../src/views/finish-guides.js';
import { bearControlView } from '../src/views/bear-control.js';
import { describeTack, stateBeforeCommand } from '../src/engine/tack-analysis.js';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const length = vector => Math.hypot(vector.x, vector.y);
const straight = extra => createScenario({ windMode: 'steady', maxShift: 0, windContrast: 0, ...extra });
const upwind = extra => straight({ courseMode: COURSE_MODE.FINISH_UPWIND, ...extra });

describe('course selection and existing rounding behavior', () => {
  it('defaults missing saved course settings to the unchanged port course', () => {
    const old = straight(), explicit = straight({ courseMode: COURSE_MODE.ROUND_PORT });
    assert.equal(old.config.courseMode, COURSE_MODE.ROUND_PORT);
    assert.deepEqual(courseGeometry(old), courseGeometry(explicit));
    assert.deepEqual(courseGeometry(old).mark, { x: 0, y: 1000 });
    assert.deepEqual(gateEnd(old, 0), { x: 0, y: 1100 });
    assert.deepEqual(advance(initialBoat(), old, 90), advance(initialBoat(), explicit, 90));
    assert.throws(() => straight({ courseMode: 'invalid-course' }), /course mode/);
  });
  it('initializes every mode and clears course, race, comparison and inspection state when reset', () => {
    const trainer = createTrainer();
    for (const courseMode of Object.values(COURSE_MODE)) {
      trainer.togglePause(); trainer.act('tack'); trainer.tick(.2);
      trainer.state.inspection = { number: 1 }; trainer.state.benchmark = {};
      trainer.reset({ ...trainer.state.scenario.config, courseMode, courseLength: 300, boatLength: 2, gateBoatLengths: 10 });
      assert.equal(trainer.state.phase, 'ready'); assert.deepEqual(trainer.state.boat, initialBoat());
      assert.equal(trainer.state.draft.courseMode, courseMode); assert.equal(trainer.state.scenario.config.courseMode, courseMode);
      assert.equal(trainer.state.benchmark, null); assert.equal(trainer.state.inspection, null);
      assert.equal(trainer.state.computer.boat.time, 0); assert.equal(trainer.state.raceTime, 0);
      const scenario = trainer.state.scenario;
      trainer.reset(scenario.config);
      assert.deepEqual(trainer.state.scenario, scenario);
      assert.equal(courseGeometry(scenario).mark === null, courseMode === COURSE_MODE.FINISH_UPWIND);
    }
  });
  it('keeps wind generation, speed response and tack trajectories identical between rounding sides', () => {
    const port = createScenario({ windField: 'organic', courseMode: COURSE_MODE.ROUND_PORT });
    const starboard = createScenario({ windField: 'organic', courseMode: COURSE_MODE.ROUND_STARBOARD });
    assert.deepEqual(port.wind, starboard.wind); assert.deepEqual(port.organicWind, starboard.organicWind);
    assert.deepEqual(advance(applyAction(initialBoat(), 'tack', port), port, 20),
      advance(applyAction(initialBoat(), 'tack', starboard), starboard, 20));
  });
  it('mirrors finish direction and required tack while retaining the same finite gate and clearance', () => {
    const port = straight(), starboard = straight({ courseMode: COURSE_MODE.ROUND_STARBOARD });
    near(finishFraction(port, { x: 1, y: 1050 }, { x: -1, y: 1052 }, 0, 1, 'starboard'), .5);
    near(finishFraction(starboard, { x: -1, y: 1050 }, { x: 1, y: 1052 }, 0, 1, 'port'), .5);
    assert.equal(finishFraction(starboard, { x: -1, y: 1050 }, { x: 1, y: 1052 }, 0, 1, 'starboard'), null);
    assert.equal(finishFraction(starboard, { x: 1, y: 1050 }, { x: -1, y: 1052 }, 0, 1, 'port'), null);
    assert.equal(finishFraction(starboard, { x: -1, y: 1101 }, { x: 1, y: 1101 }, 0, 1, 'port'), null);
    assert.equal(finishFraction(starboard, { x: -1, y: 1001 }, { x: 1, y: 1001 }, 0, 1, 'port'), null);
    assert.deepEqual(gateEnd(port, 0), gateEnd(starboard, 0));
  });
  it('sails a close starboard-side rounding with the same mirrored trajectory as port rounding', () => {
    const port = straight(), starboard = straight({ courseMode: COURSE_MODE.ROUND_STARBOARD });
    const a = advance(applyAction({ ...initialBoat(), position: { x: 100, y: 1000 } }, 'bear', port), port, 100);
    const start = applyAction({ ...initialBoat(), tack: 'port', position: { x: -100, y: 1000 } }, 'bear', starboard);
    const b = advance(start, starboard, 100);
    assert.ok(a.finished && b.finished); near(a.time, b.time); near(a.distance, b.distance);
    near(a.position.x, -b.position.x); near(a.position.y, b.position.y);
    assert.ok(cross(direction(sailingHeading(start, starboard)), subtract({ x: 0, y: 1000 }, start.position)) < 0);
    const wrong = bearControlView({ scenario: starboard, boat: initialBoat(), phase: 'sailing' });
    assert.ok(wrong.description.includes('port') || !wrong.description.includes('only on starboard'));
  });
});

describe('fixed upwind finish segment', () => {
  it('uses exactly 1000 m, 100 m and a 5 m boat, independently of stale rounding dimensions', () => {
    const scenario = upwind({ courseLength: 300, boatLength: 2, gateBoatLengths: 3 });
    const course = courseGeometry(scenario);
    assert.deepEqual(course.center, { x: 0, y: 1000 });
    assert.deepEqual(course.start, { x: -50, y: 1000 }); assert.deepEqual(course.end, { x: 50, y: 1000 });
    assert.equal(course.mark, null); assert.equal(course.requiredTack, null);
    assert.equal(scenario.config.courseLength, 1000); assert.equal(scenario.config.boatLength, 5);
    near(length(subtract(course.end, course.start)), 100);
    scenario.wind = [{ time: 0, direction: 0 }, { time: 10, direction: -25 }, { time: 20, direction: 25 }];
    for (const time of [0, 5, 10, 20, 100]) assert.deepEqual(courseGeometry(scenario, time), course);
    assert.deepEqual(courseGeometry(structuredClone(scenario), 200), course);
  });
  it('constructs correct fixed geometry for any initial world wind and start position', () => {
    const start = { x: 120, y: -30 };
    for (const angle of [0, 37, 123, 240]) {
      const course = fixedUpwindFinish(angle, start), line = subtract(course.end, course.start), up = direction(angle);
      near(length(subtract(course.center, start)), 1000); near(dot(subtract(course.center, start), up), 1000);
      near(length(line), 100); near(dot(line, up), 0);
      near(length(subtract(course.start, course.center)), 50); near(length(subtract(course.end, course.center)), 50);
      const below = { x: course.center.x - up.x * 10, y: course.center.y - up.y * 10 };
      const above = { x: course.center.x + up.x * 10, y: course.center.y + up.y * 10 };
      near(courseCrossingFraction({ ...course, ...courseRules({ courseMode: COURSE_MODE.FINISH_UPWIND }) }, below, above, 'port'), .5);
    }
  });
  it('detects continuous finite crossings on either tack without pin-rounding requirements', () => {
    const scenario = upwind();
    for (const tack of ['port', 'starboard']) for (const x of [-50, -49, 0, 49, 50]) {
      near(finishFraction(scenario, { x, y: 999 }, { x, y: 1002 }, 0, 1, tack), 1/3);
    }
    for (const x of [-50.01, 50.01]) assert.equal(finishFraction(scenario, { x, y: 999 }, { x, y: 1002 }, 0, 1, 'port'), null);
    assert.equal(finishFraction(scenario, { x: 0, y: 1002 }, { x: 0, y: 999 }, 0, 1, 'starboard'), null);
    assert.equal(finishFraction(scenario, { x: 0, y: 999 }, { x: 0, y: 999 }, 0, 1, 'starboard'), null);
    const boat = advance({ ...initialBoat(), tack: 'port', position: { x: 0, y: 999.9 } }, scenario, .25);
    assert.ok(boat.finished); near(boat.position.y, 1000);
  });
  it('renders the finish pins and four bounded guides in both cameras, without a windward mark or bias hint', () => {
    const trainer = createTrainer({ courseMode: COURSE_MODE.FINISH_UPWIND, windMode: 'steady' });
    const paths = [];
    for (const follow of [false, true]) {
      const view = courseView({ ...trainer.state, follow, viewport: { width: 950, height: 580, padding: { left: 15, right: 15, top: 65, bottom: 25 } } });
      assert.equal((view.markup.match(/class="finish-layline"/g) ?? []).length, 4);
      assert.equal((view.markup.match(/class="finish-pin"/g) ?? []).length, 2);
      assert.match(view.markup, /clip-path="url\(#finish-guides-clip\)"/);
      assert.match(view.markup, /offset="0.7"/); assert.match(view.markup, /opacity="0.28"/);
      assert.doesNotMatch(view.markup, /WINDWARD MARK|favored|bias|recommend|#33956b|#d66b67/i);
      assert.doesNotMatch(view.markup, /NaN|undefined|Infinity/);
      paths.push([...view.markup.matchAll(/class="finish-layline"[^>]* d="([^"]+)"/g)].map(match => match[1]));
    }
    assert.deepEqual(paths[0], paths[1]); assert.equal(COURSE_THEME.starboard, '#527780'); assert.equal(COURSE_THEME.port, '#bc8b3f');
  });
});

describe('live finish laylines and geometric bias', () => {
  it('generates two 200 m tack approaches per fixed pin with smoothed, finish-local wind', () => {
    const scenario = upwind();
    scenario.wind = [{ time: 0, direction: 0 }, { time: 2, direction: 0 }, { time: 3, direction: 20 }];
    const before = finishLaylines(scenario, 0), during = finishLaylines(scenario, 3), after = finishLaylines(scenario, 12);
    assert.equal(before.lines.length, 4); assert.ok(during.wind.direction > 0 && during.wind.direction < 20);
    near(after.wind.direction, 20);
    for (const [i, line] of after.lines.entries()) {
      assert.deepEqual(line.start, i < 2 ? scenario.course.start : scenario.course.end);
      near(length(subtract(line.end, line.start)), FINISH_GUIDES.length);
      assert.notDeepEqual(line.end, before.lines[i].end);
    }
    near(finishLaylines(scenario, 3.001).wind.direction, finishLaylines(scenario, 2.999).wind.direction, .05);
    const traveling = createScenario({ courseMode: COURSE_MODE.FINISH_UPWIND, windField: 'traveling', windMode: 'persistent', shiftStartTime: 0, persistentShiftAngle: 12, transitionWidth: 30 });
    assert.equal(windAtPosition(traveling, 0, 0, 90), 0);
    near(prevailingFinishWind(traveling, 90).direction, 12);
  });
  it('keeps smoothing query order and camera/display work out of authoritative physics', () => {
    const scenario = createScenario({ courseMode: COURSE_MODE.FINISH_UPWIND, windField: 'organic' });
    const expected = advance(initialBoat(), scenario, 100);
    for (const time of [120, 0, 50, 100, 20]) finishLaylines(scenario, time);
    assert.deepEqual(advance(initialBoat(), scenario, 100), expected);
    assert.deepEqual(finishLaylines(scenario, 40), finishLaylines(structuredClone(scenario), 40));
  });
  it('derives neutral and opposing pin bias by projection, including rotated original winds', () => {
    for (const angle of [0, 37, 123, 240]) {
      const course = fixedUpwindFinish(angle);
      near(finishLineBias(course, angle).differenceMeters, 0);
      assert.equal(finishLineBias(course, angle).favoredPin, null);
      const left = finishLineBias(course, angle - 15), right = finishLineBias(course, angle + 15);
      near(left.differenceMeters, -right.differenceMeters);
      near(Math.abs(left.differenceMeters), 100 * Math.sin(15 * Math.PI / 180));
      assert.notEqual(left.favoredPin, right.favoredPin);
      for (const shift of [-15, 15]) {
        const bias = finishLineBias(course, angle + shift), other = bias.favoredPin === 'start' ? 'end' : 'start';
        assert.ok(dot(course[bias.favoredPin], direction(angle + shift)) < dot(course[other], direction(angle + shift)));
      }
    }
  });
});

describe('course-aware boats and hindsight', () => {
  it('completes a player Finish Upwind leg and replays its exact result', () => {
    const trainer = createTrainer({ courseMode: COURSE_MODE.FINISH_UPWIND, windMode: 'steady', windContrast: 0 });
    trainer.togglePause();
    for (let i = 0; i < 3000 && !trainer.state.boat.finished; i++) {
      if (trainer.state.boat.tack === 'starboard' && trainer.state.boat.position.y >= 500) trainer.act('tack');
      trainer.tick(.125);
    }
    assert.equal(trainer.state.phase, 'finished'); near(trainer.state.boat.position.y, 1000);
    assert.ok(Math.abs(trainer.state.boat.position.x) <= 50);
    assert.deepEqual(replay(trainer.state.scenario, trainer.state.commands, trainer.state.boat.time + 1).finish, trainer.state.boat);
  });
  it('finishes both new courses in steady, shifting and organic wind without hindsight', { timeout: 20000 }, () => {
    for (const courseMode of [COURSE_MODE.ROUND_STARBOARD, COURSE_MODE.FINISH_UPWIND]) {
      for (const extra of [{ windMode: 'steady' }, { windMode: 'oscillating', seed: 42 }, { windField: 'organic', seed: 314159 }]) {
        const scenario = createScenario({ courseMode, courseLength: 300, ...extra }), computer = createLiveComputer();
        for (let i = 0; i < 6000 && !computer.boat.finished; i++) advanceLiveComputer(computer, scenario, .25);
        assert.ok(computer.boat.finished, JSON.stringify({ courseMode, extra, boat: computer.boat }));
        if (courseMode === COURSE_MODE.ROUND_STARBOARD) assert.equal(computer.boat.tack, 'port');
        else { near(computer.boat.position.y, 1000); assert.ok(Math.abs(computer.boat.position.x) <= 50); }
        assert.deepEqual(replay(scenario, computer.commands, computer.boat.time + 1).finish, computer.boat);
      }
    }
  });
  it('finds and replays both new hindsight courses, retaining bias metadata without live recommendations', { timeout: 20000 }, () => {
    for (const courseMode of [COURSE_MODE.ROUND_STARBOARD, COURSE_MODE.FINISH_UPWIND]) {
      const scenario = straight({ courseMode, courseLength: 100 });
      const route = search(scenario, { interval: 4, width: 100, cell: 3 }).route;
      assert.ok(route?.finish.finished, courseMode);
      assert.deepEqual(replay(scenario, route.commands, route.finish.time + 1).finish, route.finish);
      if (courseMode === COURSE_MODE.FINISH_UPWIND) {
        const index = route.commands.findIndex(command => command.action === 'tack');
        const explanation = describeTack(scenario, route, index, 1, stateBeforeCommand(scenario, route, index), { checked: false, continuedTime: null, delay: 10 });
        assert.equal(explanation.requiredFinishTack, null); near(explanation.finishBias.differenceMeters, 0);
        assert.ok(explanation.finishAreaWind);
      } else assert.equal(route.finish.tack, 'port');
    }
  });
});
