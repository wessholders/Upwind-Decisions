import { it } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaticSite } from '../scripts/build.js';
import { createStaticServer } from '../scripts/serve.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesAt(resolve(directory, entry.name)) : resolve(directory, entry.name)))).flat();
}

it('builds a clean static site with unchanged assets and a complete browser module graph', async t => {
  const output = await buildStaticSite();
  await writeFile(resolve(output, 'obsolete-build-file.txt'), 'stale output');
  await buildStaticSite();
  await assert.rejects(access(resolve(output, 'obsolete-build-file.txt')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(output)).sort(), ['index.html', 'src', 'wind-sandbox.html']);

  const expected = ['index.html', 'wind-sandbox.html', ...(await filesAt(resolve(root, 'src'))).map(file => relative(root, file))].sort();
  const built = (await filesAt(output)).map(file => relative(output, file)).sort();
  assert.deepEqual(built, expected);
  for (const file of built) assert.deepEqual(await readFile(resolve(output, file)), await readFile(resolve(root, file)), file);

  const server = createStaticServer(output);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pending = ['/src/optimizer.worker.js'], visited = new Set();
  for (const page of ['/index.html', '/wind-sandbox.html']) {
    const response = await fetch(base + page);
    assert.equal(response.status, 200);
    for (const [, asset] of (await response.text()).matchAll(/(?:src|href)="(\.\/[^"\s]+\.(?:js|css))"/g)) {
      pending.push(new URL(asset, base + page).pathname);
    }
  }
  while (pending.length) {
    const asset = pending.pop();
    if (visited.has(asset)) continue;
    visited.add(asset);
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-type'), asset.endsWith('.css') ? /text\/css/ : /text\/javascript/, asset);
    for (const [, specifier] of (await response.text()).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.ok(specifier.startsWith('.'), `Unexpected runtime dependency: ${specifier}`);
      pending.push(new URL(specifier, base + asset).pathname);
    }
  }
  assert.ok(visited.size > 30, 'The built site must include both entry points and their shared engine/worker modules.');
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.name, 'upwind-decisions');
  assert.equal(resolve(root, config.assets.directory), output);
  assert.equal(config.build.command, 'npm run build');
});
