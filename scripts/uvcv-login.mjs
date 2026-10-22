import { chromium } from 'playwright';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { resolveUvcvSessionPath } from '../src/uvcv.mjs';

const profile = process.env.WEB2API_UVCV_PROFILE || join(process.env.LOCALAPPDATA || join(homedir(), '.local/share'), 'Web2API', 'uvcv-profile');
const sessionPath = resolveUvcvSessionPath();
await mkdir(profile, { recursive: true });
await mkdir(dirname(sessionPath), { recursive: true });

const context = await chromium.launchPersistentContext(profile, { headless: false, viewport: { width: 1280, height: 900 } });
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://uvcv.edu.pe/login/index.php?loginredirect=1', { waitUntil: 'domcontentloaded' });
  console.log('Inicia sesión con tu cuenta institucional en la ventana abierta. Esperando MoodleSession...');

  let cookies = [];
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    cookies = (await context.cookies('https://uvcv.edu.pe')).filter(c => c.domain === 'uvcv.edu.pe' || c.domain.endsWith('.uvcv.edu.pe'));
    if (cookies.some(c => c.name === 'MoodleSession')) {
      const response = await context.request.get('https://uvcv.edu.pe/my/', { maxRedirects: 0, timeout: 15000 });
      if (response.status() === 200 && /"sesskey":"/.test(await response.text())) break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!cookies.some(c => c.name === 'MoodleSession')) throw new Error('LOGIN_TIMEOUT');

  const state = { cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })), origins: [] };
  await writeFile(`${sessionPath}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(`${sessionPath}.tmp`, sessionPath);
  console.log(`Sesión guardada: ${state.cookies.length} cookie(s) de uvcv.edu.pe en ${sessionPath}`);
} catch (error) {
  console.error(error.code === 'LOGIN_TIMEOUT'
    ? 'No se detectó una sesión válida en 10 minutos. Si Google bloquea el navegador automatizado, usa el navegador que ya tienes autorizado y vuelve a exportar la cookie MoodleSession.'
    : `No se pudo guardar la sesión: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close();
}
