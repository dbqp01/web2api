import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { uvcvSessionAvailable } from './uvcv.mjs';

export function connectionStatus(definitions, scope) {
  const ids = Object.keys(definitions);
  if (scope === 'controlled_lab_only') return { connections: [{ id: 'lab', name: 'Laboratorio local', status: 'available', configured: true, available: true,
    transport: 'http_only', interface: 'rest_and_mcp', workflow_ids: ids, setup_commands: [], limitations: ['Productos ficticios con llamadas HTTP reales.', 'Las escrituras requieren confirmación. El estado es temporal y no hay pagos.'] }] };
  const publicIds = ids.filter(id => !definitions[id].auth), uvcvIds = ids.filter(id => id.startsWith('uvcv_'));
  const uvcvConfigured = uvcvSessionAvailable();
  // Do not import Baileys or read session contents to show configuration metadata.
  const local = join(process.cwd(), '.local');
  const whatsappDir = process.env.WEB2API_WHATSAPP_AUTH || (existsSync(local) ? join(local, 'whatsapp-auth') : join(process.env.LOCALAPPDATA || join(homedir(), '.local/share'), 'Web2API', 'whatsapp-auth'));
  const whatsappInstalled = existsSync(new URL('./mcp-whatsapp.mjs', import.meta.url));
  const whatsappConfigured = whatsappInstalled && existsSync(join(whatsappDir, 'creds.json'));
  return { connections: [
    { id: 'public_http', name: 'APIs públicas', status: publicIds.length ? 'available' : 'unavailable', configured: true, available: !!publicIds.length, transport: 'http_only', interface: 'rest_and_mcp', workflow_ids: publicIds, setup_commands: [], limitations: ['Lecturas HTTP con validación de contrato y respuesta.', 'Requieren conexión a Internet; la disponibilidad del proveedor no se comprueba aquí.'] },
    { id: 'uvcv', name: 'UVCV · Moodle', status: uvcvIds.length ? 'available' : uvcvConfigured ? 'configured' : 'setup_required', configured: uvcvConfigured, available: !!uvcvIds.length, transport: 'http_only', interface: 'rest_and_mcp', workflow_ids: uvcvIds,
      setup_commands: existsSync(new URL('../scripts/uvcv-login.mjs', import.meta.url)) ? ['npm run uvcv:login', 'npm run uvcv:validate', 'npm run uvcv:keepalive'] : [],
      limitations: ['Cursos, tareas, notas y calendario: solo lectura.', 'Una sesión configurada puede haber expirado. Reinicia la app tras configurar y validar el conector.'] },
    { id: 'whatsapp', name: 'WhatsApp', status: !whatsappInstalled ? 'unavailable' : whatsappConfigured ? 'configured' : 'setup_required', configured: whatsappConfigured, available: false, transport: 'whatsapp_multidevice_websocket', interface: 'dedicated_mcp', workflow_ids: [],
      setup_commands: whatsappInstalled ? ['npm run whatsapp:login', 'npm run mcp:whatsapp'] : [],
      limitations: [whatsappInstalled ? 'MCP separado de solo lectura; no forma parte del catálogo HTTP.' : 'El paquete independiente no incluye este conector. Se ejecuta desde el repositorio con sus dependencias.', 'Cliente no oficial (Baileys): puede infringir los términos de WhatsApp y provocar restricciones.', 'No se comprueba la conexión ni se leen mensajes desde esta pantalla.'] },
  ] };
}
