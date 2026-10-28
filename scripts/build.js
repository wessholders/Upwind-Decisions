import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildStaticSite() {
  const destination = resolve(root, 'dist');
  // Always clean only this repository's fixed build output, independently of
  // the shell's working directory. Never delete a caller-supplied path.
  if (dirname(destination) !== resolve(root) || relative(root, destination) !== 'dist') {
    throw new Error('Build output must be the project dist directory.');
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of ['index.html', 'wind-sandbox.html', 'src']) {
    await cp(resolve(root, name), resolve(destination, name), { recursive: true });
  }
  return destination;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = await buildStaticSite();
  const entries = await readdir(destination);
  console.log(`Built ${relative(root, destination)}/: ${entries.join(', ')}. Static assets copied without transformation.`);
}
