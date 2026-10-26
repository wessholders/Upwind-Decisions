import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { DEFAULT_CONFIG } from '../src/engine/config.js';
import { createScenario } from '../src/engine/wind.js';
import { replay } from '../src/engine/race.js';

it('loads the native optimizer worker and returns a structured-cloneable, replayable route', { timeout: 20000 }, async t => {
  const worker = new Worker(new URL('./worker-harness.js', import.meta.url));
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  assert.equal(ready.ready, true);
  worker.postMessage({ scenario: null, commands: [], time: 0 });
  const [failure] = await once(worker, 'message');
  assert.equal(typeof failure.error, 'string');
  const scenario = createScenario({ ...DEFAULT_CONFIG, courseLength: 100, windMode: 'steady' });
  worker.postMessage({ scenario, commands: [], time: 0 });
  const [response] = await once(worker, 'message');
  assert.equal(response.error, undefined);
  assert.equal(response.result.route.finish.finished, true);
  const { commands, finish } = response.result.route;
  assert.deepEqual(replay(scenario, commands, finish.time + 1).finish, finish);
  assert.ok(response.result.comparisons.length > 0);
});
