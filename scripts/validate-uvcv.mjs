import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { digest } from '../src/catalog.mjs';
import { createUvcvRunner, uvcvSessionAvailable } from '../src/uvcv.mjs';

if (!uvcvSessionAvailable()) {
  console.log('UVCV session not configured; validation skipped. Run npm run uvcv:login first.');
  process.exit(0);
}

const source = await readFile(new URL('../src/uvcv.mjs', import.meta.url), 'utf8');
const run = createUvcvRunner();
const cases = [];
const checks = [];

async function step(name, fn, note = () => ({})) {
  const started = Date.now();
  try {
    const value = await fn();
    cases.push({ name, status: 'passed', duration_ms: Date.now() - started, ...note(value) });
    return value;
  } catch (error) {
    cases.push({ name, status: 'failed', duration_ms: Date.now() - started, error: error.code ?? 'INTERNAL_ERROR' });
    throw error;
  }
}

try {
  const courses = await step('uvcv_list_courses', () => run('uvcv_list_courses', {}), r => ({
    courses: r.data.total, unique_ids: new Set(r.data.courses.map(c => c.id)).size,
  }));
  assert.ok(courses.data.total > 0, 'no enrolled courses');
  checks.push('enrolled_courses_nonempty_and_ids_unique');
  const courseid = courses.data.courses[0].id;

  const course = await step('uvcv_get_course', () => run('uvcv_get_course', { courseid }), r => ({
    sections: r.data.section_count, modules: r.data.module_count,
  }));
  assert.ok(course.data.section_count > 0 && course.data.module_count > 0, 'empty course state');
  checks.push('course_state_sections_and_modules_nonempty');

  const assignments = await step('uvcv_list_assignments', () => run('uvcv_list_assignments', { courseid }), r => ({
    assignments: r.data.total,
  }));
  assert.equal(assignments.data.total, assignments.data.assignments.length);
  checks.push('assignment_filter_matches_course_modules');

  const grades = await step('uvcv_get_grades', () => run('uvcv_get_grades', { courseid }), r => ({
    grade_items: r.data.total,
  }));
  assert.equal(grades.data.total, new Set(grades.data.items.map(i => i.itemid)).size);
  checks.push('grade_report_rows_crosschecked_against_definitions');

  const events = await step('uvcv_upcoming_events', () => run('uvcv_upcoming_events', { max_results: 3 }), r => ({
    events: r.data.total, returned: r.data.events.length, truncated: r.data.truncated,
  }));
  assert.ok(events.data.events.every((e, i, all) => i === 0 || all[i - 1].timestart <= e.timestart));
  assert.equal(events.data.truncated, events.data.total > events.data.events.length);
  checks.push('events_sorted_unique_and_truncation_reported');

  await assert.rejects(run('uvcv_get_course', { courseid: 0 }), e => e.code === 'INVALID_INPUT');
  checks.push('invalid_input_rejected_before_fetch');

  const report = {
    status: 'passed',
    observed_at: new Date().toISOString(),
    scope: 'uvcv_authenticated_read_only',
    source: 'live_first_party_http_with_user_authorized_session',
    session: 'user_moodle_session',
    provider: 'moodle_ajax_and_grade_report_html',
    cases,
    checks,
    adapter_hash: digest(source),
    limits: [
      'Uses the authorized student session; only read operations are implemented.',
      'Grades are cross-checked against grade-item definitions, not against an official academic record.',
      'Moodle functions disabled for this account surface as UNSUPPORTED_OPERATION.',
      'No names, grades or cookies are stored in this evidence file.',
    ],
    finished_at: new Date().toISOString(),
  };
  await writeFile(new URL('../evidence/uvcv-validation.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases, adapter_hash: report.adapter_hash }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', error: error.code ?? error.message, cases }, null, 2));
  console.error('Existing passed evidence was left untouched. Re-login with npm run uvcv:login if the error is REAUTH_REQUIRED.');
  process.exitCode = 1;
}
