import { createUvcvRunner } from '../src/uvcv.mjs';

const interval = Number(process.env.WEB2API_UVCV_KEEPALIVE_MS ?? 20 * 60 * 1000);
if (!Number.isInteger(interval) || interval < 60_000) {
  console.error('WEB2API_UVCV_KEEPALIVE_MS must be an integer >= 60000.');
  process.exit(1);
}
const once = process.argv.includes('--once');
const runner = createUvcvRunner();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; });

do {
  const at = new Date().toISOString();
  try {
    await runner.touch();
    console.log(`${at} UVCV session alive`);
  } catch (error) {
    const code = error.code ?? 'INTERNAL_ERROR';
    console.error(`${at} UVCV keepalive failed: ${code}`);
    if (['REAUTH_REQUIRED', 'SESSION_NOT_CONFIGURED'].includes(code)) {
      console.error('Run npm run uvcv:login, then restart the keepalive.');
      process.exitCode = 1;
      break;
    }
    if (code === 'RATE_LIMITED') { await sleep(interval * 3); continue; }
  }
  if (once || stopping) break;
  await sleep(interval);
} while (!stopping);
