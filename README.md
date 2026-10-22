# Web2API 0.3.0 · aplicación independiente

App local con backend Node, interfaz web, CLI de aprendizaje y API REST propia.
Codex y MCP son consumidores opcionales. La ejecución de los workflows utiliza
HTTP, sin visión, clics ni llamadas a un modelo.

## Arrancar la app

Desde el código fuente, con Node 24.x y las dependencias instaladas:

```powershell
npm start
```

Abre `http://127.0.0.1:4319`. La UI crea su propia sesión local HttpOnly; no
necesitas copiar una clave API en la página. El servidor solo escucha en loopback.
Si quieres consumidores REST externos al navegador, configura
`WEB2API_API_KEY` en el proceso del servidor. No se imprime ni se entrega a la UI.

El paquete independiente se genera con `npm run build` en
`artifacts/web2api-app`. Allí puedes ejecutar `node dist/app.mjs` o `npm start`,
sin Codex, manifests de plugin, npm install ni node_modules. `WEB2API_PORT`
permite cambiar el puerto; el predeterminado es 4319.

La interfaz permite seleccionar un workflow, introducir argumentos, ejecutar y
leer resultado/evidencia. También permite cargar una captura JSON revisada y
probar un caso reservado antes de incorporar el workflow. El catálogo y
`GET /v1/openapi.json` se actualizan inmediatamente. Los workflows aprendidos
persisten en `%LOCALAPPDATA%/Web2API/workflows` en Windows, fuera del paquete;
`WEB2API_WORKFLOWS` permite elegir otro directorio local.

La demo incluida usa dos portátiles como demostraciones y reserva MacBook Pro.
No descubre una web desde una URL de forma autónoma: las acciones, las capturas
y los permisos siguen siendo aportados por el agente o una persona.
Ver [plan de conexiones autenticadas](AUTHENTICATION.md) y
[evidencia de la app independiente](evidence/app-validation.json).

## Aprender sin modificar el motor

```powershell
npm run learn -- examples/learn-laptop.json .local/my-workflows
```

En el paquete sin dependencias: `node dist/learn.mjs examples/learn-laptop.json <directorio>`.
El archivo contiene operaciones de lectura revisadas, demostraciones de entrenamiento
y evaluaciones con entradas distintas. El compilador infiere la receta; luego se
ejecutan todas las llamadas y se compara el resultado con la evidencia reservada.
No guarda un workflow si falla la evaluación ni sobrescribe uno existente.

Una receta aprendida es JSON de datos; no ejecuta scripts. Los hashes detectan
desajustes locales, no firman artefactos ni autorizan capturas ajenas. Cada
operación/destino debe ser revisado antes de la validación. La primera conexión
autenticada, UVCV, se describe más abajo; el resto de sitios con sesión sigue
pendiente.

## Integraciones verificadas

Ya existe una integración real de **usgarhoteles.com**: consulta habitaciones y
tarifas para fechas concretas mediante HTTP y contrasta el inventario con el
calendario público. Se expone por REST y MCP. La ejecución no importa Playwright,
no usa visión, no hace clics y no invoca un LLM.

También se probaron **Demoblaze, Automation Exercise y SauceDemo**, con revisión
visual del agente y casos reservados que el compilador no recibió. Se publican
dos workflows adicionales; SauceDemo se rechaza por falta de una ruta API
observada. Ver [informe con capturas](MULTISITE_REPORT.md).

También se probaron WhatsApp y X: [informe social](SOCIAL_REPORT.md). X permitió
dos recorridos API completos dentro de la sesión del navegador. WhatsApp tiene
ahora un puente propio de solo lectura sobre Baileys, fuera del catálogo HTTP
(ver más abajo). El compilador sigue rechazando esos transportes en lugar de
tratarlos como HTTP público sin credenciales.

El compilador nuevo (`src/read-workflow.mjs`) infiere parámetros, IDs dependientes
de respuestas previas, esquemas y comprobaciones entre pasos. No recibe rutas
hardcodeadas por sitio: las obtiene de trazas; sí requiere demostraciones y una
lista de operaciones de lectura revisadas. El caso de Automation Exercise usa
su API oficial documentada: la UI no produjo ese tráfico JSON. Las reglas de
búsqueda inferidas son hipótesis contrastadas con muestras, no semántica universal.

El descubrimiento fue asistido por el agente, observando navegación y tráfico de
la web pública. **No es un descubridor universal autónomo.** El laboratorio
separado demuestra captura → parametrización → replay → verificación de escrituras
con productos ficticios. No se modificó el código ni el servidor de USGAR.

## UVCV autenticado (Moodle)

La primera conexión con sesión propia está implementada sobre **UVCV**
(`https://uvcv.edu.pe`), con la cuenta institucional autorizada por el usuario.
El login se completa una vez en un perfil aislado; la app conserva solo las
cookies de `uvcv.edu.pe` (la esencial es `MoodleSession`) en un archivo local
ignorado por git y excluido de los paquetes. El runtime no abre navegador:
obtiene `sesskey` desde `/my/`, llama al endpoint AJAX de Moodle y expone cinco
lecturas tipadas por REST y MCP:

- `uvcv_list_courses`: cursos matriculados.
- `uvcv_get_course`: secciones y módulos del curso.
- `uvcv_list_assignments`: módulos `assign`; cero es un resultado válido.
- `uvcv_get_grades`: notas del usuario, contrastadas con las definiciones de ítems.
- `uvcv_upcoming_events`: calendario próximo, ordenado y con truncación explícita.

```powershell
npm run uvcv:login      # perfil Playwright dedicado; login manual con Google
npm run uvcv:validate   # llamadas reales y evidence/uvcv-validation.json
```

`uvcv:login` no toca el perfil personal de Brave. Si Google bloquea el navegador
automatizado, la alternativa es exportar únicamente `MoodleSession` desde la
sesión ya autorizada. El catálogo incluye UVCV solo si existe la sesión y el
informe de validación coincide con el hash de `src/uvcv.mjs`; si no, el arranque
falla con `CATALOG_NOT_VERIFIED` en lugar de publicar un adapter sin probar.

### MCP dedicado

```powershell
npm run mcp:uvcv
```

Expone exactamente las cinco tools UVCV por stdio, sin cargar el catálogo público
ni Playwright. El repo incluye `.mcp.json` para un cliente Claude Code; en otro
cliente, el bloque es:

```json
{
  "mcpServers": {
    "web2api-uvcv": {
      "command": "node",
      "args": ["src/mcp-uvcv.mjs"]
    }
  }
}
```

`npm run build` genera además `dist/mcp-uvcv.mjs`, autocontenido y sin
`node_modules`. Las tools devuelven `structuredContent` y errores con código
estable (`REAUTH_REQUIRED`, `SESSION_NOT_CONFIGURED`, etc.).

### Mantener la sesión viva

`MoodleSession` es una cookie de sesión (`expires=-1`) y el plazo real lo impone
Moodle en el servidor: en esta cuenta, alrededor de una hora de inactividad.
Ponerle una fecha lejana a la cookie no lo cambia; el servidor invalida su propio
registro de sesión. La vía correcta es mantener actividad con
`core_session_touch`, que UVCV expone y ya está verificado:

```powershell
npm run uvcv:keepalive
```

Hace un `core_session_touch` cada 20 minutos (configurable con
`WEB2API_UVCV_KEEPALIVE_MS`, mínimo 60 s) y usa `GET /my/` solo si esa función no
está disponible. Si recibe `REAUTH_REQUIRED`, se detiene y hay que repetir
`uvcv:login`. No guarda credenciales de Google ni alarga la cookie: mantiene
caliente la sesión mientras el proceso esté vivo. Si suspendes la máquina o
cierras el proceso, el plazo sigue corriendo. Para probar una sola vez:

```powershell
npm run uvcv:keepalive -- --once
```

Límites: solo lectura; no entrega tareas, no envía mensajes ni modifica el perfil.
Una función deshabilitada por Moodle devuelve `UNSUPPORTED_OPERATION`; una sesión
expirada devuelve `REAUTH_REQUIRED` y no se reintenta. No se resuelven CAPTCHA,
no se rotan proxies, no se falsifican huellas y no se evaden controles de acceso:
un sitio que los exija se marca no soportado. Las notas se contrastan entre la
página y las definiciones de ítems; no son un récord académico oficial.

## WhatsApp de solo lectura (Baileys)

WhatsApp Web no expone una API JSON: el cliente multidispositivo usa WebSockets
cifrados. Para la cuenta personal se implementó un puente con
`@whiskeysockets/baileys` **6.7.24**, la versión estable marcada `legacy`
(`7.0.0-rc` incluye un puente nativo que no se usa aquí). Es un cliente **no
oficial** y su uso puede violar los Términos de WhatsApp y provocar restricciones
de la cuenta; el usuario asume ese riesgo.

```powershell
npm run whatsapp:login      # QR + sincronización inicial; WhatsApp > Dispositivos vinculados
npm run mcp:whatsapp        # MCP stdio con cuatro tools de lectura
npm run whatsapp:validate   # llamadas reales y evidence/whatsapp-validation.json
npm run whatsapp:logout -- --yes  # desvincula y borra credenciales y snapshot
```

`whatsapp:login` guarda las credenciales del dispositivo en
`.local/whatsapp-auth` (o en `%LOCALAPPDATA%/Web2API/whatsapp-auth`; se puede
cambiar con `WEB2API_WHATSAPP_AUTH`). No se copian cookies del navegador. Tras
vincular, el proceso espera la sincronización inicial, guarda el snapshot en
`store.json` y termina; el MCP lo carga al arrancar.

Tools:

- `whatsapp_status`: estado de la conexión y tamaño de la instantánea.
- `whatsapp_list_chats`: chats ordenados por actividad reciente.
- `whatsapp_get_messages`: mensajes de un chat en orden cronológico.
- `whatsapp_search_messages`: búsqueda de texto, opcionalmente por chat.

El puente no envía mensajes, no actualiza presencia y no pide confirmaciones de
lectura; el protocolo puede emitir confirmaciones de entrega automáticas. La
instantánea se guarda en `.local/whatsapp-auth/store.json` (máximo 1000 chats y
200 mensajes por chat), se llena con la sincronización inicial y los eventos en
vivo, y el MCP la carga al arrancar. Es un archivo local con datos personales,
ignorado por git y excluido de los paquetes. No descarga multimedia: expone
tipo, texto o pie de foto y fecha. No es un archivo completo del historial ni
sustituye una exportación oficial.

Errores: `SESSION_NOT_CONFIGURED` (falta vincular), `SESSION_NOT_READY`
(reconectando) y `REAUTH_REQUIRED` (WhatsApp cerró la sesión; repetir el login).

Este MCP no forma parte del paquete sin dependencias: requiere `npm install` y
Node 24. Baileys resuelve `libsignal` desde un repositorio Git, así que `git`
debe estar en `PATH` al instalar. El catálogo HTTP y el MCP genérico no cargan
Baileys.

## Ejecutar

Desde el repositorio fuente (el ZIP contiene el plugin runtime): requisitos
Node **24.x**, npm y conexión a USGAR para las pruebas externas.
Windows/PowerShell verificado con Node 24.20.0 y npm 11.19.0.

```powershell
npm ci --ignore-scripts
npm test
npm run test:live
npm run build
npm run check
npm run test:package
```

`test:live` hace unas pocas consultas públicas de lectura. Guarda evidencia
con fecha y falla si cambia el contrato, los totales o el contraste de inventario.
`build` genera OpenAPI y el paquete autocontenido en `artifacts/plugin/web2api`.
Ese paquete necesita Node 24, pero **no necesita npm ni node_modules al ejecutarse**.
El smoke del paquete prueba handshake, catálogo tipado y una búsqueda real desde
otro proceso. No equivale a una prueba de la interfaz del chat de Codex.

El laboratorio requiere Chromium solo durante descubrimiento:

```powershell
npx playwright install chromium
npm run demo
```

`demo` crea una tienda temporal, ejecuta demostraciones UI predefinidas, captura
solo JSON sintético y compila los parámetros a partir de dos valores distintos.
Cierra el navegador y repite 75 llamadas HTTP en tres sesiones nuevas. Usa el
archivo persistido del carrito como oráculo adicional. Inyecta cambios de esquema,
ruta rota, sesión inválida, rate limit y falso éxito HTTP sin persistencia.
Todos los servidores del demo se cierran al terminar. No es una medición de días
de funcionamiento ni de cobertura de webs externas.

Para reproducir las nuevas pruebas desde cero, con Chromium instalado:

```powershell
npm run discover:multisite
npm run test:multisite
npm run build
npm run test:package
```

El recolector guarda capturas en `artifacts/multisite/` y trazas públicas sin
cabeceras/cookies en `.local/multisite/`. El compilador usa dos demostraciones de
Demoblaze y tres de Automation Exercise; reserva un caso de cada sitio para
probar generalización. El navegador se cierra antes del replay. Las capturas no
se consideran revisadas visualmente por el mero hecho de regenerarlas: esa
revisión debe hacerla una persona o el agente con visión.

Herramientas añadidas:

- `lookup_demoblaze_phone({"product_name":"Nexus 6"})`: categoría Phones →
  seleccionar ID por título → ficha → contrastar atributos. Nombre exacto.
- `search_automation_products({"query":"tshirt"})`: catálogo → búsqueda por
  formulario API → contrastar IDs, nombres, marca y precio; la coincidencia
  observada puede estar en el nombre o la categoría. Vacío válido.

Los resultados conservan las etiquetas de precio del sitio (`$`, `Rs.`), sin
inventar moneda ISO. Máximo 250 registros por array y 256 KiB por respuesta:
se rechaza lo que excede los límites, sin truncación oculta. No implementan compra,
carrito, pagos ni disponibilidad comercial. Ambas herramientas se ejecutan sin
cookies, login, navegador o LLM. Las recetas solo llaman operaciones revisadas;
un POST de búsqueda no se clasifica como escritura por el verbo HTTP.

## Herramienta real

```json
{
  "name": "search_usgar_rooms",
  "arguments": {
    "check_in": "2026-11-01",
    "check_out": "2026-11-03",
    "guests": 2,
    "max_results": 20
  }
}
```

Usa fechas actuales/futuras de Lima, entre 1 y 30 noches y 1–8 huéspedes.
`max_results` tiene default 20 y máximo 50. Se devuelve `total` y `truncated`.
Fechas del ejemplo deben actualizarse cuando venzan.

La tarea compone dos operaciones observadas desde el navegador:

- `GET https://usgarhoteles.com/api/rooms?checkIn=…&checkOut=…&lang=es`
- `GET https://usgarhoteles.com/api/rooms/calendar?from=…&to=…`

El calendario incluye cada noche desde la llegada hasta el día anterior a la
salida. La cantidad de cada habitación debe coincidir con el mínimo de esas noches.
Se comprueban moneda, noches, capacidad, totales y rangos; se filtran habitaciones
con inventario positivo y capacidad suficiente. La entrada `guests` filtra
capacidad en este adapter; **no demuestra precios por ocupación ni recargos**.

Los precios están en **centavos USD**, con estándar/no reembolsable por noche y
por estadía. Impuestos, cargos y condiciones finales no se verificaron aparte.
`availability_confirmed` siempre es `false`: se contrastan dos respuestas del mismo
sitio, no se consulta directamente su PMS ni se bloquea inventario. La evidencia
incluye las URLs exactas, hora de observación y límites. Caché de 30 segundos y
máximo 32 consultas por proceso; los fallos no se cachean. No hay retry automático.

## REST privado local

```powershell
# Genera el secreto solo en el proceso local; no se imprime ni se guarda.
$env:WEB2API_API_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
npm run serve
```

Escucha solo en `127.0.0.1:4319`. Otro terminal debe recibir la misma variable
por un medio local seguro si se va a usar como cliente; los tests crean servidor
y cliente con un secreto en memoria. No existe endpoint público desplegado.

Rutas: `GET /v1/catalog` y `POST /v1/workflows/{workflow_id}`, todas requieren
`Authorization: Bearer …`. La segunda acepta el objeto `arguments` del ejemplo.
Ver `openapi.json`. Errores: `INVALID_INPUT`, `UNAUTHORIZED`, `RATE_LIMITED`,
`UPSTREAM_CHANGED`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT`,
`INVENTORY_UNVERIFIED`, `REAUTH_REQUIRED`, `SESSION_NOT_CONFIGURED`,
`UNSUPPORTED_OPERATION`, `NO_MATCH`, `VERIFICATION_FAILED` y `BODY_TOO_LARGE`.
El cuerpo de error no incluye detalles upstream ni secretos.

## Plugin de Codex

El paquete utiliza `plugin.json`, `mcp.json` y `skills/usgar-rooms/SKILL.md`, según
la [documentación oficial](https://developers.openai.com/plugins/build/plugins).
El MCP es stdio; el host inicia `node ${PLUGIN_ROOT}/dist/mcp.mjs`.
La conexión local no necesita una credencial de USGAR para estas lecturas públicas.

Después de `npm run build`, existe un catálogo local de desarrollo en
`.agents/plugins/marketplace.json`. Para instalarlo con el CLI disponible:

```powershell
codex plugin marketplace add .
codex plugin add web2api@web2api-local
```

La versión 0.2.1 se instaló localmente por CLI el 17 de octubre de 2026. El listado
de Codex confirma su instalación y se probó el MCP desde su carpeta instalada.
Verifica la aparición de la herramienta en un chat nuevo de Codex y usa fechas
elegidas por ti: la interfaz del chat no forma parte de la evidencia automatizada.
No se publica ni reemplaza `web2api-forge`.

Para desarrollo del laboratorio, establece `WEB2API_RECIPE` con la ruta absoluta
a `.local/recipe.json`, `WEB2API_ORIGIN` con la URL del laboratorio y
`WEB2API_UPSTREAM_TOKEN` con su token sintético. `npm run demo` configura todo
automáticamente dentro de sus procesos. Al fijar `WEB2API_RECIPE`, el catálogo
expone solo `search_products`, `get_cart` y `add_to_cart`. La escritura requiere
`confirmed=true`; ese flag **no sustituye la autorización humana del host**.
El laboratorio es de un solo actor; no acredita escrituras concurrentes.

## Evidencia y límites

- `evidence/multisite-validation.json`: siete escenarios de lectura, dos casos
  reservados, vacíos/producto ausente y rechazo del recorrido de SauceDemo.
- `evidence/multisite-visual-review.json`: revisión visual explícita del agente.
- `recipes/`: workflows generados, con parámetros y dependencias, sin código
  arbitrario ni credenciales. Alterar motor, políticas o recetas exige revalidar.
- `evidence/usgar-discovery.json`: solicitudes reales observadas; GET solamente.
- `evidence/usgar-validation.json`: dos rangos de fechas, variación de huéspedes,
  contraste con calendario, MCP y REST. Incluye resultados públicos y timestamps.
- `evidence/uvcv-validation.json`: cinco lecturas reales con la sesión autorizada,
  conteos, comprobaciones y hash del adapter; sin nombres, notas ni cookies.
- `evidence/whatsapp-validation.json`: se genera tras vincular WhatsApp y ejecutar
  `whatsapp:validate`; conteos y comprobaciones, sin JIDs, chats ni mensajes.
- `artifacts/lab-report.json`: 75 llamadas de replay / tres sesiones y errores
  inyectados. Se genera de nuevo con `npm run demo`.
- `artifacts/runtime-metafile.json`: dependencias del bundle. La compilación
  rechaza Playwright en el runtime; esto acompaña las pruebas del recorrido,
  no las sustituye.

Las pruebas unitarias cubren rechazo de inventario inconsistente, fechas ignoradas,
entradas inválidas, redirecciones, HTML inesperado y rate limits sin retry.
No se promete un porcentaje de confianza del modelo. La evidencia externa es una
prueba puntual con dos escenarios, no un SLA ni compatibilidad universal.
La API de USGAR no se ha identificado como contrato público estable del proveedor;
si cambia, falla y requiere revisión, no reparación automática.

No se crean reservas, pagos, suscripciones, mensajes ni datos de huéspedes reales.
`.local/`, `artifacts/` y `.env` están ignorados. No se conservan cookies, cabeceras
de autenticación, perfiles, almacenamiento del navegador ni HAR en los paquetes.
La cookie de UVCV vive solo en `.local/uvcv-session.json` (o en el directorio de
estado del usuario), fuera de git y del build; el login escribe únicamente las
cookies de `uvcv.edu.pe`. El inventario y las tarifas públicos sí se incluyen como
evidencia fechada.

La versión 0.3.0 incorpora rechazo de errores de negocio en JSON, búsquedas
incompletas/duplicadas y vacíos falsos contrastados con el catálogo. La regla de
búsqueda debe explicar el conjunto completo de las demostraciones antes de
compilar; también se contrastan campos anidados. No soporta todavía búsquedas
paginadas o semánticas que las muestras no permitan demostrar.

Calidad de esta versión:

```powershell
npm test
npm run test:multisite
npm run build
npm run check
npm run test:app
npm run test:learning
npm run test:package
```

`npm test` incluye 24 contratos sintéticos renombrados/anidados y 96 consultas
reservadas. `test:app` arranca el paquete fuera del repositorio, incorpora un
workflow mediante HTTP y comprueba persistencia tras reiniciar. Estos tests no
acreditan login de terceros, autonomía desde una URL ni estabilidad durante días.

Ver `SDD.md` para el alcance implementado y los criterios de la siguiente fase.
