# Conexiones autenticadas

Estado: sesión web implementada para UVCV/Moodle y puente de solo lectura para
WhatsApp; OAuth y X siguen pendientes. La sesión de la UI local es independiente
y no constituye un conector de terceros.

## API oficial con OAuth

Primera opción cuando el proveedor ofrece la operación necesaria. La persona
autoriza permisos mínimos en el navegador del sistema; la app recibe el callback
local, valida `state` y usa PKCE. El backend guarda los tokens; nunca se incluyen
en recetas, evidencia, HTML o respuestas de workflows. Para una primera versión,
se pueden conservar solo en memoria y pedir reconexión al reiniciar. La
persistencia necesita un almacén de credenciales del sistema, no un JSON en el
paquete.

La [recomendación de IETF para apps nativas](https://datatracker.ietf.org/doc/html/rfc8252)
describe navegador externo, callback de loopback y PKCE. La
[documentación de X](https://docs.x.com/fundamentals/authentication/overview)
separa autenticación de aplicación y de usuario. Las credenciales de desarrollador
y los permisos todavía no están configurados en Web2API.

## Sesión web autorizada: UVCV/Moodle

Implementada para UVCV (`https://uvcv.edu.pe`) con la cuenta institucional que la
persona autorizó. `scripts/uvcv-login.mjs` abre un perfil Playwright dedicado,
la persona completa el login de Google y el script espera una lectura real de
`/my/` antes de guardar nada. Solo persiste las cookies de `uvcv.edu.pe` —la
esencial es `MoodleSession`— en un JSON local con permisos de usuario, fuera de
git, del build y de la evidencia. No copia el perfil completo.

El bootstrap inicial de esta máquina partió de la sesión ya abierta en Brave y
extrajo únicamente esa cookie del sitio; no se importaron cookies de otros
orígenes ni el almacenamiento completo. Es una excepción de bootstrap autorizada,
no el flujo normal de renovación.

[Playwright comparte cookies entre un BrowserContext y context.request](https://playwright.dev/docs/api/class-apirequestcontext).
Esto permite verificar el login sin imprimir valores de cookies. Para el replay
la app no usa Playwright: envía la cookie al endpoint AJAX de Moodle, obtiene
`sesskey` desde `/my/` y valida el contrato de cada respuesta. Las cookies por sí
solas pueden no bastar en otros sitios: CSRF, cabeceras ligadas a la sesión o
firmas necesitan evidencia y soporte específico.

Estados: `disconnected → awaiting_login → verifying → connected`. Un 401/403 o
una redirección a login devuelven `REAUTH_REQUIRED`; 429 devuelve `RATE_LIMITED`
sin reintento. Una función que Moodle deshabilita para la cuenta devuelve
`UNSUPPORTED_OPERATION`. La revocación borra el archivo de sesión. Lecturas y
escrituras mantienen permisos separados: UVCV solo expone lecturas. No hay
fallback a clics, visión o LLM durante la ejecución.

La cookie `MoodleSession` no lleva `Expires`; el límite efectivo es la
inactividad configurada en Moodle (alrededor de una hora en esta cuenta). No se
puede volver inmortal desde el cliente con una fecha lejana: el servidor invalida
su registro. `npm run uvcv:keepalive` envía `core_session_touch` cada 20 minutos
mientras el proceso vive; si el proceso o la máquina se detienen, el plazo sigue
corriendo y hay que renovar con `uvcv:login`. No almacena credenciales de Google
ni modifica la cookie.

La prueba de aceptación se ejecuta con `npm run uvcv:validate`: login de la
persona → cinco lecturas reales → entrada inválida rechazada → evidencia con
hash del adapter. La sesión expirada se prueba de forma simulada en
`test/uvcv.test.mjs` (redirección, 401/403 y rate limit) para no esperar a que
venza la sesión real.

## Protocolo específico: WhatsApp (Baileys, solo lectura)

La [arquitectura multidispositivo de Meta](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)
incluye claves por dispositivo y sincronización cifrada; no existe un GET de JSON
con el historial. Para la cuenta personal se implementó un cliente del protocolo
con [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys)
**6.7.24** (dist-tag `legacy`, MIT). Es **no oficial**: puede violar los Términos
de WhatsApp y exponer la cuenta a una restricción. La persona lo autorizó con
esos límites.

`scripts/whatsapp-login.mjs` muestra un QR de vinculación y guarda las
credenciales del dispositivo en un directorio local fuera de git (`.local/` o
`%LOCALAPPDATA%`). No importa cookies ni el perfil de un navegador. El socket
reutiliza esa sesión multidispositivo; no hay envío de mensajes, presencia ni
confirmaciones de lectura. El propio protocolo puede emitir confirmaciones de
entrega automáticas.

`src/mcp-whatsapp.mjs` expone cuatro lecturas por stdio: estado, chats, mensajes
de un chat y búsqueda de texto. El login espera la sincronización inicial y
guarda la instantánea en `store.json`, junto a las credenciales; el MCP la carga
al arrancar y la actualiza con los eventos en vivo. No descarga multimedia.
`whatsapp:logout -- --yes` desvincula el dispositivo y borra credenciales y
snapshot. Para WhatsApp Business sigue siendo preferible su API oficial si cubre
la tarea; este puente no equivale a ella.

Estados: `awaiting_pairing → connecting → connected`; una sesión cerrada por
WhatsApp pasa a `logged_out` y exige repetir el login. `SESSION_NOT_CONFIGURED`
significa que falta vincular; `SESSION_NOT_READY`, que el socket está
reconectando. La validación real se ejecuta con `npm run whatsapp:validate`
después de vincular.

## Lo probado y el siguiente criterio

| Vía | Evidencia actual | Falta para afirmar soporte |
|---|---|---|
| UI local | Cookie HttpOnly/SameSite, clave REST separada, origen ajeno rechazado y rotación al reiniciar | No acredita autenticación de terceros |
| HTTP público | Tres herramientas y un workflow adicional aprendido con replay real | Ampliar patrones y descubrimiento |
| UVCV/Moodle | Cinco lecturas reales con sesión autorizada, notas contrastadas, errores de sesión simulados y hash del adapter | Ampliar a más funciones Moodle; probar expiración real y reconexión |
| X | Dos cadenas API con la sesión del navegador de investigación, fuera de esta app | Login propio, ejecutor, expiración y reconexión probados |
| WhatsApp | Vinculación real, sincronización inicial, cuatro tools MCP y validación con 1000 chats / 6480 mensajes | Historial completo (solo copia acotada) y reconexión prolongada |

La prueba de aceptación para una conexión es: login de la persona → lectura
API → entrada nueva → sesión expirada rechazada → reconexión → misma lectura,
sin cookies en outputs ni clics durante ejecución. UVCV ya cumple login,
lecturas reales, entrada nueva y rechazo simulado de sesión; la expiración real
con el paso del tiempo y la reconexión desde `uvcv:login` siguen pendientes de
observación. WhatsApp cumple vinculación real, sincronización inicial, cuatro
tools y `whatsapp:validate`; falta observar reconexión durante horas. Los demás
sitios permanecen fuera del catálogo hasta pasar la prueba.
