import qrcode from 'qrcode-terminal';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWhatsAppRunner, resolveWhatsAppAuthDir } from '../src/whatsapp.mjs';

const authDir = resolveWhatsAppAuthDir();
const runner = createWhatsAppRunner({
  pair: true,
  onQr: qr => {
    console.log('WhatsApp > Dispositivos vinculados > Vincular un dispositivo. El QR se renueva solo.');
    qrcode.generate(qr, { small: true });
  },
});

await runner.start();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const deadline = Date.now() + 20 * 60 * 1000;
let connectedAt = null;
let lastChange = null;
let lastTotal = -1;

while (Date.now() < deadline) {
  const status = (await runner.run('whatsapp_status', {})).data;
  if (status.state === 'logged_out' || status.state === 'error') {
    console.error(`No se pudo vincular: ${status.state}${status.last_error ? ` (${status.last_error})` : ''}.`);
    process.exitCode = 1;
    break;
  }
  if (status.state === 'connected' && !connectedAt) {
    connectedAt = Date.now();
    console.log(`Dispositivo vinculado. Credenciales en ${authDir}`);
    console.log('Esperando la sincronización inicial de chats...');
  }
  const total = status.chat_count + status.message_count;
  if (connectedAt && total > 0) {
    if (total !== lastTotal) {
      lastTotal = total;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > 30_000) {
      console.log(`Sincronizados ${status.chat_count} chats y ${status.message_count} mensajes.`);
      break;
    }
  }
  if (connectedAt && Date.now() - connectedAt > 3 * 60 * 1000) {
    console.log(`Fin de la espera: ${status.chat_count} chats y ${status.message_count} mensajes guardados.`);
    break;
  }
  await sleep(1000);
}

await runner.close();
if (connectedAt) await writeFile(join(authDir, 'login-done'), new Date().toISOString()).catch(() => {});
if (!process.exitCode && !connectedAt) {
  console.error('No se vinculó ningún dispositivo en 20 minutos.');
  process.exitCode = 1;
}
