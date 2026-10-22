import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

for (const dir of ['src', 'scripts', 'test', 'web', 'browser']) {
  for (const name of await readdir(dir)) {
    if (!/\.m?js$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
  }
}
for (const file of ['plugin.json', 'mcp.json', 'openapi.json']) JSON.parse(await readFile(file, 'utf8'));
const manifest = JSON.parse(await readFile('plugin.json', 'utf8'));
assert(manifest.extensions['com.openai'].interface.shortDescription.length <= 30);
const runtime = await readFile('src/runner.mjs', 'utf8');
assert(!/playwright|puppeteer|page\.click|eval\(/.test(runtime));
const definition = JSON.parse(await readFile('openapi.json', 'utf8'));
assert(definition.paths['/v1/workflows/search_usgar_rooms']);
assert.equal(definition.paths['/v1/workflows/search_usgar_rooms'].post.operationId, 'search_usgar_rooms');
console.log('Syntax, manifests and HTTP-only runtime checks passed.');
