import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, WorkflowError } from './contracts.mjs';

const defaultOrigin = 'https://uvcv.edu.pe';
const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
};

const sessionSchema = z.object({
  cookies: z.array(z.object({ name: z.string().min(1), value: z.string(), domain: z.string() }).passthrough()).min(1),
}).passthrough();

const course = z.object({
  id: z.number().int().positive(), fullname: z.string().min(1).max(500), shortname: z.string().min(1).max(200),
  categoryid: z.number().int().positive().optional(), startdate: z.number().int().nonnegative().optional(),
  enddate: z.number().int().nonnegative().optional(), visible: z.boolean().optional(),
}).strict();
const module = z.object({ id: z.string().regex(/^\d+$/), name: z.string().min(1).max(500), type: z.string().min(1).max(80),
  plugin: z.string().min(1).max(80), url: z.url().nullable(), visible: z.boolean(), sectionid: z.string().regex(/^\d+$/).optional() }).strict();
const section = z.object({ id: z.string().regex(/^\d+$/), number: z.number().int().nonnegative(), title: z.string().max(500),
  visible: z.boolean(), modules: z.array(module) }).strict();
const gradeItem = z.object({ itemid: z.string().regex(/^\d+$/), name: z.string().min(1).max(500),
  grade: z.string().max(200).nullable(), feedback: z.string().max(2000).nullable() }).strict();
const event = z.object({ id: z.number().int().positive(), name: z.string().min(1).max(500), timestart: z.number().int().nonnegative(),
  time: z.iso.datetime(), courseid: z.number().int().positive().optional(), modulename: z.string().max(80).optional(),
  url: z.url().nullable(), overdue: z.boolean().optional() }).strict();

const evidence = z.object({
  source_mode: z.literal('observed_first_party_http'), scope: z.literal('uvcv_authenticated_read_only'),
  transport: z.literal('http_only'), session: z.literal('user_moodle_session'), observed_at: z.iso.datetime(),
  verification: z.string().min(1), cached: z.boolean(),
  limits: z.array(z.string()).min(1),
}).strict();
const output = data => z.object({ data, evidence }).strict();

export const uvcvInputs = {
  uvcv_list_courses: z.object({}).strict(),
  uvcv_get_course: z.object({ courseid: z.number().int().positive().max(1_000_000_000) }).strict(),
  uvcv_list_assignments: z.object({ courseid: z.number().int().positive().max(1_000_000_000) }).strict(),
  uvcv_get_grades: z.object({ courseid: z.number().int().positive().max(1_000_000_000) }).strict(),
  uvcv_upcoming_events: z.object({ max_results: z.number().int().min(1).max(50).default(20) }).strict(),
};

const limits = [
  'Authenticated read-only session of the UVCV Moodle account; no submissions, messages or profile changes.',
  'Only Moodle functions exposed to this account are used. Unsupported functions fail with UNSUPPORTED_OPERATION.',
  'Grades are reported by Moodle and cross-checked against the course grade-item definitions; they are not an official academic record.',
  'The session expires independently of this app; REAUTH_REQUIRED means re-run the local login script.',
];
export const uvcvOutputs = {
  uvcv_list_courses: output(z.object({ courses: z.array(course).max(250), total: z.number().int().nonnegative(), truncated: z.boolean() }).strict()),
  uvcv_get_course: output(z.object({ courseid: z.number().int().positive(), fullname: z.string().max(500),
    section_count: z.number().int().nonnegative(), module_count: z.number().int().nonnegative(), sections: z.array(section).max(100) }).strict()),
  uvcv_list_assignments: output(z.object({ courseid: z.number().int().positive(), assignments: z.array(module).max(250), total: z.number().int().nonnegative() }).strict()),
  uvcv_get_grades: output(z.object({ courseid: z.number().int().positive(), items: z.array(gradeItem).max(250), total: z.number().int().nonnegative() }).strict()),
  uvcv_upcoming_events: output(z.object({ events: z.array(event).max(50), total: z.number().int().nonnegative(), truncated: z.boolean() }).strict()),
};

export const uvcvDefinitions = {
  uvcv_list_courses: { input: uvcvInputs.uvcv_list_courses, output: uvcvOutputs.uvcv_list_courses, effect: 'read', auth: 'user_session',
    description: 'Lista los cursos matriculados en UVCV. Sesión autenticada de solo lectura; no envía tareas ni modifica el perfil.' },
  uvcv_get_course: { input: uvcvInputs.uvcv_get_course, output: uvcvOutputs.uvcv_get_course, effect: 'read', auth: 'user_session',
    description: 'Devuelve secciones y módulos (recursos, cuestionarios, foros, tareas) de un curso UVCV, contrastando que el curso esté matriculado.' },
  uvcv_list_assignments: { input: uvcvInputs.uvcv_list_assignments, output: uvcvOutputs.uvcv_list_assignments, effect: 'read', auth: 'user_session',
    description: 'Lista las tareas (módulo assign) de un curso UVCV. Vacío es un resultado válido; no entrega ni califica tareas.' },
  uvcv_get_grades: { input: uvcvInputs.uvcv_get_grades, output: uvcvOutputs.uvcv_get_grades, effect: 'read', auth: 'user_session',
    description: 'Notas del usuario en un curso UVCV. Contraste entre la página de notas y las definiciones de ítems; no es un récord académico oficial.' },
  uvcv_upcoming_events: { input: uvcvInputs.uvcv_upcoming_events, output: uvcvOutputs.uvcv_upcoming_events, effect: 'read', auth: 'user_session',
    description: 'Próximos eventos del calendario UVCV (exámenes, tutorías, entregas) con fecha, curso y enlace. Solo lectura.' },
};

export function resolveUvcvSessionPath(explicit) {
  if (explicit) return explicit;
  if (process.env.WEB2API_UVCV_SESSION) return process.env.WEB2API_UVCV_SESSION;
  const local = join(process.cwd(), '.local', 'uvcv-session.json');
  if (existsSync(local)) return local;
  return join(process.env.LOCALAPPDATA || join(homedir(), '.local/share'), 'Web2API', 'uvcv-session.json');
}

export function uvcvSessionAvailable(path) {
  return existsSync(resolveUvcvSessionPath(path));
}

const decode = value => String(value ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

const timed = async (url, init, timeoutMs) => {
  try { return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new WorkflowError(['TimeoutError', 'AbortError'].includes(error.name) ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE'); }
};

async function readLimited(response, limit) {
  if (!response.body) throw new WorkflowError('UPSTREAM_UNAVAILABLE');
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new WorkflowError('BODY_TOO_LARGE', 413); }
      chunks.push(Buffer.from(value));
    }
  } catch (error) { throw error instanceof WorkflowError ? error : new WorkflowError('UPSTREAM_UNAVAILABLE'); }
  return Buffer.concat(chunks).toString('utf8');
}

function checkStatus(response) {
  if (response.status === 429) throw new WorkflowError('RATE_LIMITED', 429);
  if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) throw new WorkflowError('REAUTH_REQUIRED', 401);
  if (!response.ok) throw new WorkflowError('UPSTREAM_UNAVAILABLE');
}

function ajaxFailure(result) {
  const code = String(result?.exception?.errorcode ?? '').toLowerCase();
  const message = String(result?.exception?.message ?? '');
  if (code === 'invalidtoken' || code === 'sessionexpired' || /token|sesión|session/i.test(code)) throw new WorkflowError('REAUTH_REQUIRED', 401);
  if (/webservice|servicenotavailable|accessexception|disponible|deshabilitado/i.test(`${code} ${message}`)) throw new WorkflowError('UNSUPPORTED_OPERATION');
  throw new WorkflowError('UPSTREAM_REJECTED');
}

export function createUvcvRunner({ sessionPath, origin = defaultOrigin, timeoutMs = 20000 } = {}) {
  const path = resolveUvcvSessionPath(sessionPath);
  const cache = new Map();
  let boot, starting;

  const readSession = async () => {
    let raw;
    try { raw = JSON.parse(await readFile(path, 'utf8')); }
    catch { throw new WorkflowError('SESSION_NOT_CONFIGURED', 401); }
    const session = parse(sessionSchema, raw, 'SESSION_NOT_CONFIGURED');
    const cookies = session.cookies.filter(c => c.domain === 'uvcv.edu.pe' || c.domain.endsWith('.uvcv.edu.pe'));
    if (!cookies.some(c => c.name === 'MoodleSession')) throw new WorkflowError('SESSION_NOT_CONFIGURED', 401);
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  };

  async function bootstrap() {
    if (boot && Date.now() - boot.at < 55 * 60 * 1000) return boot;
    starting ??= (async () => {
      const cookie = await readSession();
      const response = await timed(`${origin}/my/`, { headers: { ...browserHeaders, Cookie: cookie } }, timeoutMs);
      checkStatus(response);
      const html = await readLimited(response, 524288);
      const sesskey = /"sesskey":"([^"]+)"/.exec(html)?.[1];
      const userId = Number(/"userId":(\d+)/.exec(html)?.[1]);
      if (!sesskey || !userId) throw new WorkflowError('REAUTH_REQUIRED', 401);
      return (boot = { sesskey, userId, cookie, at: Date.now() });
    })().finally(() => { starting = null; });
    return starting;
  }

  async function ajax(methodname, args) {
    const current = await bootstrap();
    const response = await timed(`${origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(current.sesskey)}`, {
      method: 'POST', headers: { ...browserHeaders, Cookie: current.cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    }, timeoutMs);
    checkStatus(response);
    let results;
    try { results = JSON.parse(await readLimited(response, 262144)); }
    catch (error) { throw error instanceof WorkflowError ? error : new WorkflowError('UPSTREAM_CHANGED'); }
    const result = Array.isArray(results) ? results[0] : null;
    if (!result) throw new WorkflowError('UPSTREAM_CHANGED');
    if (result.error) ajaxFailure(result);
    return result.data;
  }

  const cached = (key, ttl, load) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve({ value: structuredClone(hit.value), cached: true });
    return load().then(value => {
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, { value: structuredClone(value), at: Date.now() });
      return { value, cached: false };
    });
  };

  const courses = () => cached('courses', 60000, async () => {
    const data = await ajax('core_course_get_enrolled_courses_by_timeline_classification', { offset: 0, limit: 0, classification: 'all', sort: 'fullname' });
    const items = (Array.isArray(data?.courses) ? data.courses : []).slice(0, 250).map(c => ({
      id: c.id, fullname: decode(c.fullname), shortname: decode(c.shortname),
      ...(Number.isInteger(c.categoryid) ? { categoryid: c.categoryid } : {}),
      ...(Number.isInteger(c.startdate) ? { startdate: c.startdate } : {}),
      ...(Number.isInteger(c.enddate) ? { enddate: c.enddate } : {}),
      ...(typeof c.visible === 'boolean' ? { visible: c.visible } : {}),
    }));
    if (new Set(items.map(c => c.id)).size !== items.length) throw new WorkflowError('VERIFICATION_FAILED');
    return { courses: items, total: items.length, truncated: (data?.courses?.length ?? 0) > items.length };
  });

  const courseState = courseid => cached(`course:${courseid}`, 30000, async () => {
    const listed = await courses();
    if (!listed.value.courses.some(c => c.id === courseid)) throw new WorkflowError('NO_MATCH', 404);
    const raw = await ajax('core_courseformat_get_state', { courseid });
    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (String(state?.course?.id) !== String(courseid)) throw new WorkflowError('VERIFICATION_FAILED');
    const sections = (Array.isArray(state.section) ? state.section : []).map(s => ({
      id: String(s.id), number: Number(s.section) || 0, title: decode(s.title || s.rawtitle || `Sección ${s.section ?? ''}`),
      visible: s.visible !== false, modules: [],
    }));
    const byId = new Map(sections.map(s => [s.id, s]));
    for (const cm of Array.isArray(state.cm) ? state.cm : []) {
      const target = byId.get(String(cm.sectionid));
      if (!target) throw new WorkflowError('VERIFICATION_FAILED');
      target.modules.push({ id: String(cm.id), name: decode(cm.name), type: String(cm.module), plugin: String(cm.plugin),
        url: typeof cm.url === 'string' ? cm.url : null, visible: cm.uservisible !== false && cm.visible !== false });
    }
    const ids = sections.flatMap(s => s.modules.map(m => m.id));
    if (new Set(ids).size !== ids.length) throw new WorkflowError('VERIFICATION_FAILED');
    const fullname = listed.value.courses.find(c => c.id === courseid).fullname;
    return { courseid, fullname, section_count: sections.length, module_count: ids.length, sections };
  });

  async function gradePage(courseid) {
    const current = await bootstrap();
    const response = await timed(`${origin}/grade/report/user/index.php?id=${courseid}`, { headers: { ...browserHeaders, Cookie: current.cookie } }, timeoutMs);
    checkStatus(response);
    const html = await readLimited(response, 524288);
    if (!/user-grade/.test(html)) throw new WorkflowError('UPSTREAM_CHANGED');
    return html;
  }

  const run = async (name, raw) => {
    const input = parse(uvcvInputs[name] ?? z.never(), raw);
    let data, cachedFlag = false;
    if (name === 'uvcv_list_courses') {
      const result = await courses(); data = result.value; cachedFlag = result.cached;
    } else if (name === 'uvcv_get_course') {
      const result = await courseState(input.courseid); data = result.value; cachedFlag = result.cached;
    } else if (name === 'uvcv_list_assignments') {
      const result = await courseState(input.courseid);
      const assignments = result.value.sections.flatMap(s => s.modules.filter(m => m.type === 'assign').map(m => ({ ...m, sectionid: s.id })));
      data = { courseid: input.courseid, assignments, total: assignments.length }; cachedFlag = result.cached;
    } else if (name === 'uvcv_get_grades') {
      const key = `grades:${input.courseid}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 60000) { data = structuredClone(hit.value); cachedFlag = true; }
      else {
        const [definitions, html] = await Promise.all([ajax('core_grades_get_gradeitems', { courseid: input.courseid }), gradePage(input.courseid)]);
        const known = new Map((Array.isArray(definitions?.gradeItems) ? definitions.gradeItems : []).map(g => [String(g.id), decode(g.itemname)]));
        const items = [], seen = new Set();
        for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const id = /id="row_(\d+)_\d+"/.exec(row[1])?.[1];
          if (!id || seen.has(id)) continue;
          const name = /class="gradeitemheader[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(row[1])?.[1];
          if (!known.has(id) && name) throw new WorkflowError('VERIFICATION_FAILED');
          if (!known.has(id)) continue;
          const cell = /<td[^>]*column-grade[^>]*>([\s\S]*?)<\/td>/i.exec(row[1])?.[1] ?? '';
          const inner = /<div[^>]*class="d-flex align-items-center"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/.exec(cell)?.[1];
          const feedback = /<td[^>]*column-feedback[^>]*>([\s\S]*?)<\/td>/i.exec(row[1])?.[1];
          items.push({ itemid: id, name: name ? decode(name) : known.get(id), grade: inner === undefined ? null : decode(inner) || null,
            feedback: feedback === undefined ? null : decode(feedback) || null });
          seen.add(id);
        }
        if (!items.length && known.size) throw new WorkflowError('VERIFICATION_FAILED');
        data = { courseid: input.courseid, items, total: items.length };
        if (cache.size >= 32) cache.delete(cache.keys().next().value);
        cache.set(key, { value: structuredClone(data), at: Date.now() });
      }
    } else if (name === 'uvcv_upcoming_events') {
      const result = await cached('events', 30000, async () => {
        const value = await ajax('core_calendar_get_calendar_upcoming_view', {});
        const all = (Array.isArray(value?.events) ? value.events : []).map(e => ({
          id: e.id, name: decode(e.name), timestart: e.timestart, time: new Date(e.timestart * 1000).toISOString(),
          ...(Number.isInteger(e.course?.id) ? { courseid: e.course.id } : {}),
          ...(typeof e.modulename === 'string' ? { modulename: e.modulename } : {}),
          url: typeof e.url === 'string' ? e.url : null, ...(typeof e.overdue === 'boolean' ? { overdue: e.overdue } : {}),
        })).filter(e => Number.isFinite(e.timestart) && !Number.isNaN(Date.parse(e.time))).sort((a, b) => a.timestart - b.timestart);
        if (new Set(all.map(e => e.id)).size !== all.length) throw new WorkflowError('VERIFICATION_FAILED');
        return { all };
      });
      const all = result.value.all;
      data = { events: all.slice(0, input.max_results), total: all.length, truncated: all.length > input.max_results };
      cachedFlag = result.cached;
    } else throw new WorkflowError('UNKNOWN_WORKFLOW', 404);
    return parse(uvcvOutputs[name], { data, evidence: {
      source_mode: 'observed_first_party_http', scope: 'uvcv_authenticated_read_only', transport: 'http_only',
      session: 'user_moodle_session', observed_at: new Date().toISOString(),
      verification: name === 'uvcv_get_grades' ? 'grade_report_vs_grade_item_definitions' : 'moodle_ajax_schema_and_cross_checks',
      cached: cachedFlag, limits,
    } }, 'UPSTREAM_CHANGED');
  };
  run.touch = async () => {
    try { await ajax('core_session_touch', {}); }
    catch (error) {
      if (!['UNSUPPORTED_OPERATION', 'UPSTREAM_REJECTED', 'UPSTREAM_CHANGED'].includes(error.code)) throw error;
      boot = null;
      await bootstrap();
    }
    return { observed_at: new Date().toISOString() };
  };
  return run;
}
