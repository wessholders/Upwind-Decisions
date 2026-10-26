import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStaticServer } from '../scripts/serve.js';
import { createTrainer } from '../src/race-controller.js';
import { courseView } from '../src/views/course.js';
import { resultsView } from '../src/views/results.js';

describe('static vanilla application', () => {
  it('serves the application and the entire native module graph with correct MIME types', async t => {
    const server = createStaticServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.match(html, /<script type="module" src="\.\/src\/main\.js"/);
    assert.match(html, /<button id="tack"/);
    const sandbox = await fetch(base + '/wind-sandbox.html');
    assert.equal(sandbox.status, 200);
    assert.match(await sandbox.text(), /src\/wind\/controller.js/);
    const pending = ['/src/main.js', '/src/optimizer.worker.js', '/src/wind/controller.js'];
    const visited = new Set();
    while (pending.length) {
      const asset = pending.pop();
      if (visited.has(asset)) continue;
      visited.add(asset);
      const response = await fetch(base + asset);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get('content-type'), /text\/javascript/, asset);
      for (const [, specifier] of (await response.text()).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        assert.ok(specifier.startsWith('.'), `Unexpected package import: ${specifier}`);
        pending.push(new URL(specifier, base + asset).pathname);
      }
    }
    assert.ok(visited.size >= 14);
    const css = await fetch(base + '/src/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.doesNotMatch(await css.text(), /@import|https?:/);
    for (const path of ['/.git/config', '/package.json', '/node_modules/react/index.js', '/missing', '/src/../../package.json']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });

  it('binds every UI target to real static HTML with no duplicate IDs', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    const binding = main.match(/const ids = \[([^\]]+)\]/)[1];
    for (const [, id] of binding.matchAll(/'([^']+)'/g)) assert.ok(ids.includes(id), `Missing HTML target ${id}`);
  });

  it('produces finite, uniformly scaled course geometry in both camera modes', () => {
    const { state } = createTrainer();
    for (const follow of [false, true]) {
      const view = courseView({ ...state, follow });
      assert.equal(view.viewBox.split(' ').length, 4);
      assert.doesNotMatch(view.markup, /NaN|undefined|Infinity/);
      assert.match(view.markup, /class="layline"/);
      assert.doesNotMatch(view.markup, /stroke="#b58a25"/);
    }
  });

  it('escapes worker error text in HTML results', () => {
    const { state } = createTrainer();
    const markup = resultsView(state.boat, null, '<img src=x onerror=alert(1)>');
    assert.doesNotMatch(markup, /<img/);
    assert.match(markup, /&lt;img/);
  });
});
