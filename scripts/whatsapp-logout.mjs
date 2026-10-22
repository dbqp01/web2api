import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { makeWASocket, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import { resolveWhatsAppAuthDir } from '../src/whatsapp.mjs';

const authDir = resolveWhatsAppAuthDir();
if (!process.argv.includes('--yes')) {
  console.error(`Esto desvincula el dispositivo Web2API de WhatsApp y borra ${authDir}.`);
  console.error('Ejecuta: npm run whatsapp:logout -- --yes');
  process.exit(1);
}
if (!existsSync(join(authDir, 'creds.json'))) {
  console.error('No hay una sesión de WhatsApp vinculada.');
  process.exit(1);
}

const noop = () => {};
const silentLogger = { level: 'silent', child: () => silentLogger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
const { state } = await useMultiFileAuthState(authDir);
const sock = makeWASocket({
  auth: state,
  logger: silentLogger,
  printQRInTerminal: false,
  markOnlineOnConnect: false,
  syncFullHistory: false,
  emitOwnEvents: false,
  browser: Browsers.ubuntu('Chrome'),
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 30_000);
    sock.ev.on('connection.update', async update => {
      if (update.connection === 'open') {
        clearTimeout(timer);
        try { await sock.logout(); resolve(); } catch (error) { reject(error); }
      } else if (update.connection === 'close') {
        clearTimeout(timer);
        const code = update.lastDisconnect?.error?.output?.statusCode;
        reject(new Error(`connection closed (${code ?? 'unknown'})`));
      }
    });
  });
  await rm(authDir, { recursive: true, force: true });
  console.log('Dispositivo desvinculado y credenciales locales borradas.');
} catch (error) {
  console.error(`No se pudo desvincular: ${error.message}. Puedes quitarlo desde WhatsApp > Dispositivos vinculados.`);
  process.exitCode = 1;
} finally {
  try { sock.end(undefined); } catch {}
}
