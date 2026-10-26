import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? filesAt(resolve(directory, entry.name)) : resolve(directory, entry.name)))).flat();
}
const files = (await Promise.all(['src', 'scripts', 'tests'].map(name => filesAt(resolve(root, name))))).flat();
for (const file of files) {
  if (extname(file) === '.css') continue;
  if (extname(file) !== '.js') throw new Error(`Unexpected non-JavaScript source: ${file}`);
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(checked.stderr || `Syntax check failed: ${file}`);
  const source = await readFile(file, 'utf8');
  for (const [, specifier] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (specifier.startsWith('.')) await access(resolve(dirname(file), specifier));
    else if (!specifier.startsWith('node:')) throw new Error(`Package import in ${file}: ${specifier}`);
  }
}
for (const page of ['index.html', 'wind-sandbox.html']) {
  const html = await readFile(resolve(root, page), 'utf8');
  for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/[^"\s]+\.(?:js|css))"/g)) await access(resolve(root, asset));
}
console.log(`Checked ${files.filter(file => extname(file) === '.js').length} JavaScript files, imports, and HTML entry assets. No build needed.`);
