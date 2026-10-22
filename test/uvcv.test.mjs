import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUvcvRunner } from '../src/uvcv.mjs';

const origin = 'https://uvcv.edu.pe';
const home = '<html><script>M.cfg = {"sesskey":"test-sesskey","userId":42};</script></html>';
const state = {
  course: { id: 7 },
  section: [{ id: 11, section: 0, title: 'General', visible: true }, { id: 12, section: 1, title: 'Unidad 1', visible: true }],
  cm: [
    { id: 101, sectionid: 11, name: 'Foro', module: 'forum', plugin: 'mod_forum', url: `${origin}/mod/forum/view.php?id=101`, visible: true, uservisible: true },
    { id: 102, sectionid: 12, name: 'Tarea 1', module: 'assign', plugin: 'mod_assign', url: `${origin}/mod/assign/view.php?id=102`, visible: true, uservisible: true },
    { id: 103, sectionid: 12, name: 'Examen', module: 'quiz', plugin: 'mod_quiz', url: `${origin}/mod/quiz/view.php?id=103`, visible: true, uservisible: true },
  ],
};
const courses = { courses: [{ id: 7, fullname: 'Curso &amp; Test', shortname: 'CT', categoryid: 1, startdate: 1000, enddate: 2000, visible: true }] };
const gradeItems = { gradeItems: [{ id: 201, itemname: 'Examen' }, { id: 202, itemname: 'Práctica' }] };
const events = { events: [
  { id: 302, name: 'Entrega 2', timestart: 2000, course: { id: 7 }, modulename: 'assign', url: `${origin}/mod/assign/view.php?id=102` },
  { id: 301, name: 'Examen', timestart: 1000, course: { id: 7 }, modulename: 'quiz', url: `${origin}/mod/quiz/view.php?id=103` },
] };
const gradeHtml = rows => `<html><table class="generaltable boxaligncenter user-grade"><tbody>${rows}</tbody></table></html>`;
const row = (id, name, grade, feedback = '') => `<tr><th id="row_${id}_42"><a class="gradeitemheader" href="#">${name}</a></th><td class="column-grade"><div class="d-flex align-items-center"><div>${grade}</div></div></td><td class="column-feedback">${feedback}</td></tr>`;

async function setup(t, { homeResponse = () => new Response(home), ajax, grade = gradeHtml(row(201, 'Examen', '15.00') + row(202, 'Práctica', '-', 'Buen trabajo') + '<tr><th id="row_999_42">Total</th><td class="column-grade">20</td></tr>') } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'web2api-uvcv-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, 'session.json');
  await writeFile(sessionPath, JSON.stringify({ cookies: [{ name: 'MoodleSession', value: 'secret-cookie', domain: 'uvcv.edu.pe', path: '/' }] }));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname === '/my/') return homeResponse();
    if (parsed.pathname === '/lib/ajax/service.php') return Response.json(await ajax(JSON.parse(init.body)[0]));
    if (parsed.pathname === '/grade/report/user/index.php') return new Response(grade, { headers: { 'Content-Type': 'text/html' } });
    throw new Error(`unexpected ${url}`);
  });
  return { run: createUvcvRunner({ sessionPath, origin }), sessionPath, calls };
}

test('UVCV lists enrolled courses and reuses the session while caching reads', async t => {
  const { run, calls } = await setup(t, { ajax: async ({ methodname }) => [{ error: false, data: methodname === 'core_course_get_enrolled_courses_by_timeline_classification' ? courses : {} }] });
  const first = await run('uvcv_list_courses', {});
  assert.equal(first.data.total, 1);
  assert.equal(first.data.courses[0].fullname, 'Curso & Test');
  assert.equal(first.evidence.cached, false);
  const second = await run('uvcv_list_courses', {});
  assert.equal(second.evidence.cached, true);
  assert.deepEqual(calls, [`${origin}/my/`, `${origin}/lib/ajax/service.php?sesskey=test-sesskey`]);
  assert.ok(!JSON.stringify(first).includes('secret-cookie'));
  assert.ok(!JSON.stringify(first).includes('test-sesskey'));
});

test('UVCV course state parses the stringified Moodle payload and filters assignments', async t => {
  const { run } = await setup(t, { ajax: async ({ methodname }) => [{ error: false, data: methodname === 'core_course_get_enrolled_courses_by_timeline_classification' ? courses : JSON.stringify(state) }] });
  const course = await run('uvcv_get_course', { courseid: 7 });
  assert.equal(course.data.section_count, 2);
  assert.equal(course.data.module_count, 3);
  assert.equal(course.data.sections[1].modules[0].name, 'Tarea 1');
  const assignments = await run('uvcv_list_assignments', { courseid: 7 });
  assert.deepEqual(assignments.data.assignments.map(a => [a.id, a.sectionid]), [['102', '12']]);
});

test('UVCV grades cross-check the grade report against grade-item definitions', async t => {
  const { run } = await setup(t, { ajax: async ({ methodname }) => [{ error: false, data: methodname === 'core_course_get_enrolled_courses_by_timeline_classification' ? courses : gradeItems }] });
  const result = await run('uvcv_get_grades', { courseid: 7 });
  assert.deepEqual(result.data.items.map(i => [i.itemid, i.grade, i.feedback]), [['201', '15.00', null], ['202', '-', 'Buen trabajo']]);
  assert.equal(result.data.total, 2);
  assert.equal(result.evidence.verification, 'grade_report_vs_grade_item_definitions');
});

test('UVCV refuses grade rows whose id is not in the definitions', async t => {
  const drift = gradeHtml(row(201, 'Examen', '15.00') + row(999, 'Invented', '20'));
  const { run } = await setup(t, { grade: drift, ajax: async ({ methodname }) => [{ error: false, data: methodname === 'core_course_get_enrolled_courses_by_timeline_classification' ? courses : gradeItems }] });
  await assert.rejects(run('uvcv_get_grades', { courseid: 7 }), e => e.code === 'VERIFICATION_FAILED');
});

test('UVCV sorts events, truncates explicitly and keeps ids unique', async t => {
  const { run } = await setup(t, { ajax: async ({ methodname }) => [{ error: false, data: methodname === 'core_calendar_get_calendar_upcoming_view' ? events : {} }] });
  const result = await run('uvcv_upcoming_events', { max_results: 1 });
  assert.equal(result.data.events[0].id, 301);
  assert.equal(result.data.total, 2);
  assert.equal(result.data.truncated, true);
});

test('UVCV keepalive touches the session and falls back to a page request', async t => {
  let touch = true;
  const { run, calls } = await setup(t, { ajax: async ({ methodname }) => {
    if (methodname === 'core_session_touch') return touch
      ? [{ error: false, data: true }]
      : [{ error: true, exception: { errorcode: 'webservicedisabled', message: 'El servicio Web no está disponible. (No existe o puede estar deshabilitado)' } }];
    return [{ error: false, data: courses }];
  } });
  const first = await run.touch();
  assert.ok(Date.parse(first.observed_at));
  assert.equal(calls.filter(url => url.endsWith('/my/')).length, 1);
  await run.touch();
  assert.equal(calls.filter(url => url.endsWith('/my/')).length, 1);
  touch = false;
  await run.touch();
  assert.equal(calls.filter(url => url.endsWith('/my/')).length, 2);
  assert.ok(!JSON.stringify(first).includes('test-sesskey'));
});

test('UVCV maps expired sessions, disabled services and rate limits without retrying', async t => {
  {
    const { run } = await setup(t, { homeResponse: () => new Response(null, { status: 302, headers: { Location: `${origin}/login/index.php` } }) });
    await assert.rejects(run('uvcv_list_courses', {}), e => e.code === 'REAUTH_REQUIRED');
  }
  {
    const { run, calls } = await setup(t, { ajax: async () => [{ error: true, exception: { errorcode: 'webservicedisabled', message: 'El servicio Web no está disponible. (No existe o puede estar deshabilitado)' } }] });
    await assert.rejects(run('uvcv_list_courses', {}), e => e.code === 'UNSUPPORTED_OPERATION');
    assert.equal(calls.length, 2);
  }
  {
    const { run } = await setup(t, { homeResponse: () => new Response('slow down', { status: 429 }) });
    await assert.rejects(run('uvcv_list_courses', {}), e => e.code === 'RATE_LIMITED');
  }
});

test('UVCV reports a missing session without calling upstream', async t => {
  let called = 0;
  t.mock.method(globalThis, 'fetch', async () => { called++; return new Response(home); });
  await assert.rejects(createUvcvRunner({ sessionPath: join(tmpdir(), 'no-such-uvcv-session.json'), origin })('uvcv_list_courses', {}), e => e.code === 'SESSION_NOT_CONFIGURED');
  assert.equal(called, 0);
});

test('UVCV validates input before fetching', async t => {
  const { run, calls } = await setup(t, { ajax: async () => [{ error: false, data: courses }] });
  await assert.rejects(run('uvcv_get_course', { courseid: 0 }), e => e.code === 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});
