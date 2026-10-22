import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { loadCatalog } from '../src/catalog.mjs';
import manifest from '../plugin.json' with { type: 'json' };
import { createOpenApi } from '../src/openapi.mjs';

const result = await build({ entryPoints: { mcp: 'src/mcp.mjs', 'mcp-uvcv': 'src/mcp-uvcv.mjs', learn: 'scripts/learn.mjs', app: 'src/app.mjs', api: 'scripts/serve.mjs' }, outdir: 'dist', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', target: 'node24', format: 'esm', metafile: true, legalComments: 'eof',
  banner: { js: "import { createRequire as __nodeCreateRequire } from 'node:module'; const require = __nodeCreateRequire(import.meta.url);" } });
assert(!Object.keys(result.metafile.inputs).some(path => /playwright|scripts\/discover/.test(path)), 'Browser dependency entered the runtime bundle');
assert(Object.values(result.metafile.outputs).every(output => output.imports.every(item => !item.external || item.path.startsWith('node:') || builtinModules.includes(item.path))), 'Unbundled npm runtime dependency');
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['browser/worker.mjs'], outfile: 'dist/discover.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['playwright'] });
await writeFile('artifacts/runtime-metafile.json', JSON.stringify(result.metafile, null, 2));
await writeFile('openapi.json', JSON.stringify(createOpenApi((await loadCatalog()).definitions, { learning: true, discovery: true }), null, 2));
// Package only runtime files; browser, credentials, observations and node_modules stay out.
const target = 'artifacts/plugin/web2api';
await mkdir(target, { recursive: true });
for (const file of ['plugin.json', 'mcp.json', 'README.md', 'SDD.md', 'AUTHENTICATION.md', 'MULTISITE_REPORT.md', 'SOCIAL_REPORT.md', 'openapi.json', 'skills', 'src', 'dist', 'evidence', 'recipes', 'assets', 'web', 'examples']) await cp(file, `${target}/${file}`, { recursive: true });
await writeFile(`${target}/THIRD_PARTY_NOTICES.txt`, `Bundled dependencies: see the license comments in dist/mcp.mjs.\nMCP TypeScript SDK: MIT. Zod: MIT. Build-only esbuild: MIT. Discovery-only Playwright: Apache-2.0.\n\n${await readFile('node_modules/@modelcontextprotocol/sdk/LICENSE', 'utf8')}\n\n${await readFile('node_modules/zod/LICENSE', 'utf8')}`);
console.log('Built HTTP-only MCP bundle, OpenAPI and artifacts/plugin/web2api (no runtime npm install required).');
const appTarget = 'artifacts/web2api-app';
await mkdir(appTarget, { recursive: true });
for (const file of ['README.md', 'SDD.md', 'AUTHENTICATION.md', 'MULTISITE_REPORT.md', 'SOCIAL_REPORT.md', 'openapi.json', 'src', 'dist', 'evidence', 'recipes', 'assets', 'web', 'examples']) await cp(file, `${appTarget}/${file}`, { recursive: true });
await writeFile(`${appTarget}/package.json`, JSON.stringify({ name: 'web2api-app', version: manifest.version, private: true, type: 'module', engines: { node: '>=24 <25' }, scripts: { start: 'node dist/app.mjs', learn: 'node dist/learn.mjs' } }, null, 2));
await cp(`${target}/THIRD_PARTY_NOTICES.txt`, `${appTarget}/THIRD_PARTY_NOTICES.txt`);
for (const name of ['playwright', 'playwright-core']) await cp(`node_modules/${name}`, `${appTarget}/node_modules/${name}`, { recursive: true });
await writeFile(`${appTarget}/BROWSER_SETUP.txt`, 'The HTTP runtime does not need browser dependencies. URL discovery uses the included Playwright worker.\nOn a new machine install Chromium once:\nnode node_modules/playwright/cli.js install chromium\nBrowser profiles and credentials are never included in this package.\n');
await writeFile(`${appTarget}/PLAYWRIGHT_LICENSE.txt`, await readFile('node_modules/playwright/LICENSE', 'utf8'));
// The Baileys bridge needs npm dependencies; keep it out of the dependency-free packages.
for (const base of [target, appTarget]) for (const name of ['mcp-whatsapp.mjs', 'whatsapp.mjs', 'whatsapp-store.mjs']) await rm(`${base}/src/${name}`, { force: true });
console.log('Built standalone app at artifacts/web2api-app. Run npm start; Codex and plugins are optional.');
