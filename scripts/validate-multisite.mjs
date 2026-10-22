import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { compileReadWorkflow, createReadWorkflowRunner } from '../src/read-workflow.mjs';
import { sitePolicies } from '../src/site-policies.mjs';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
await mkdir('recipes', { recursive: true });
const capture = JSON.parse(await readFile('.local/multisite/captures.json', 'utf8'));
assert.equal(capture.browser_closed, true);
const report = { status: 'failed', observed_at: new Date().toISOString(), browser_closed_before_replay: true, autonomous_discovery: false, sites: {}, negative_controls: [], scope: 'public_read_workflows_only' };
try {
  for (const [site, policy] of Object.entries(sitePolicies)) {
    const captured = capture.results[site];
    assert.equal(captured.status, 'captured', `${site}: collection failed`);
    const trainingCount = site === 'demoblaze' ? 2 : 3;
    assert(captured.traces.length > trainingCount, 'An unseen input must be held out from compilation');
    const recipe = compileReadWorkflow({ id: policy.workflow, traces: captured.traces.slice(0, trainingCount), approvedRequests: policy.approvedRequests, sourceMode: policy.sourceMode });
    const run = createReadWorkflowRunner(recipe, policy.approvedRequests);
    const cases = [];
    for (const [i, trace] of captured.traces.entries()) {
      const start = performance.now(), output = await run(trace.input);
      if (site === 'demoblaze') {
        assert.equal(output.data.title, trace.visual.name);
        assert.equal(output.data.price, trace.visual.price);
        assert.equal(Number(new URL(trace.visual.page_url).searchParams.get('idp_')), output.data.id);
      } else {
        assert.deepEqual(output.data.products.map(p => p.name).sort(), [...trace.visual.search_result_names].sort());
        const detail = output.data.products.find(p => p.id === trace.visual.id);
        assert.equal(detail.name, trace.visual.name); assert.equal(detail.price, trace.visual.price_label);
      }
      cases.push({ input: trace.input, role: i < trainingCount ? 'training_replay' : 'held_out_input', status: 'passed', duration_ms: performance.now() - start, visual: trace.visual, result: output });
    }
    if (site === 'demoblaze') {
      await assert.rejects(run({ product_name: 'nonexistent-phone-web2api' }), e => e.code === 'NO_MATCH');
    } else {
      const empty = await run({ query: 'nonexistent-product-web2api' });
      assert.deepEqual(empty.data.products, []);
    }
    await writeFile(`recipes/${site}.json`, JSON.stringify(recipe, null, 2));
    report.sites[site] = { status: 'passed', recipe_hash: hash(recipe), workflow: policy.workflow, training_demonstrations: trainingCount, held_out_cases: cases.filter(c => c.role === 'held_out_input').length, cases, negative_cases: ['absent_product'] };
  }
  assert.equal(capture.results.saucedemo.status, 'unsupported_observed_path');
  assert.throws(() => compileReadWorkflow({ id: 'sauce_lookup', traces: [{ input: { name: 'first' }, calls: [] }, { input: { name: 'second' }, calls: [] }], approvedRequests: [] }), e => e.code === 'API_PATH_NOT_OBSERVED');
  report.negative_controls.push({ site: 'saucedemo', status: 'rejected_no_observed_api', ...capture.results.saucedemo });
  report.engine_hash = hash(await readFile('src/read-workflow.mjs', 'utf8'));
  report.policy_hash = hash(await readFile('src/site-policies.mjs', 'utf8'));
  report.status = 'passed';
} catch (error) { report.failure = { code: error.code || error.name, message: error.message }; throw error; }
finally {
  await writeFile('evidence/multisite-validation.json', JSON.stringify(report, null, 2));
  await writeFile('artifacts/multisite/report.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, sites: Object.keys(report.sites), held_out_cases: Object.values(report.sites).reduce((sum, site) => sum + site.held_out_cases, 0), negative_controls: report.negative_controls.map(c => c.site), report: 'artifacts/multisite/report.json' }, null, 2));
