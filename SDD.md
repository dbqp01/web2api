# SDD — Web2API · aplicación independiente 0.3.0

Estado: backend Node e interfaz propia, tres workflows públicos iniciales, cinco
lecturas UVCV con sesión autorizada, cuatro lecturas de WhatsApp por un MCP
dedicado (Baileys) y aprendizaje/incorporación de workflows revisados sin
reiniciar. Existe CLI y paquete independiente; MCP/plugin es una integración
opcional.

`src/app.mjs` inicia UI y REST sobre el mismo servidor de loopback. El navegador
recibe una cookie de sesión local HttpOnly/SameSite, separada de la clave REST.
No se serializan secretos en HTML ni en resultados. La UI genera formularios
desde los mismos schemas usados por el runtime. Los workflows aprendidos se
guardan fuera del paquete y se cargan al reiniciar; el catálogo y OpenAPI reflejan
los nuevos workflows inmediatamente después de una evaluación exitosa.

El compilador v3 exige reglas de éxito revisadas por operación, contrasta campos
anidados y valida el conjunto completo de una búsqueda contra el catálogo.
Rechaza vacíos falsos, omisiones y duplicados cuando la semántica de filtrado se
ha establecido en las muestras. Los códigos de negocio se validan por valor, no
solo por tipo. La prueba de nombres con espacios conserva la respuesta original.

`examples/learn-laptop.json` y `evidence/learning-validation.json` acreditan
aprendizaje desde dos demostraciones y evaluación reservada. La prueba encontró
un salto de línea en el nombre de Sony vaio i7; se corrigió en el comparador
compartido, no con un adapter específico. El evaluador no entrega el caso
reservado al compilador. `evidence/app-validation.json` prueba la app empacada
fuera del repositorio, incluyendo reinicio y rechazo de orígenes ajenos.

El diseño y estado del login están en `AUTHENTICATION.md`. La sesión web de UVCV
y el puente no oficial de WhatsApp están implementados; OAuth y X no. Una UI
local autenticada no cuenta como conector de terceros.

Las pruebas sociales se documentan en `SOCIAL_REPORT.md`: X tiene replay HTTP
comprobado con sesión del navegador; WhatsApp pasó de UI comprobada a un cliente
Baileys 6.7.24 de solo lectura con MCP dedicado. La vinculación real y su
validación están pendientes de la persona. Sesión y transporte no soportados se
rechazan explícitamente al compilar.
Fecha: 17 de octubre de 2026; actualización de WhatsApp: 20 de octubre de 2026.
El SDD 0.1 adjunto en el chat era conceptual; este documento delimita lo que el
código y la evidencia demuestran.

## Objetivo y restricción

Convertir capacidades observadas de una web autorizada en workflows API con
entradas tipadas, evidencia y fallos comprobables. Codex consume el MCP; REST es
otro consumidor del mismo contrato. La ejecución utiliza exclusivamente HTTP.
Si no hay una ruta API que pase la validación, la operación no es compatible.
No existe fallback DOM, visión, browser replay ni LLM durante ejecución.

## Recorrido implementado

`Navegación pública → tráfico observado → contrato revisado → adapter HTTP →
validación semántica → REST/MCP → respuesta estructurada con procedencia`.

La inspección de USGAR fue realizada por el agente con navegación y tráfico de
primera parte, sin leer el repositorio del hotel. Las escrituras y orígenes
externos se bloquearon en la exploración de reservas. La deducción del workflow
y su adapter son trabajo asistido/manual, no un algoritmo general de descubrimiento.

El nuevo compilador `read-workflow.mjs` procesa trazas de distintos sitios con
la misma implementación. Infiere bindings de entrada, selectores de IDs desde
respuestas previas, esquemas y joins de verificación. Una lista explícita de
origen/ruta/método revisados establece qué operaciones son de lectura. Demoblaze
proporciona tráfico observado y Automation Exercise APIs documentadas contrastadas
con UI. No hay un adapter imperativo por sitio: se generan recetas de datos.
Los selectores UI, objetivos, ejemplos y permisos aún los aporta el agente.

El laboratorio original prueba otra parte automatizada: demostraciones UI con
intenciones y entradas conocidas → requests/responses → inferencia diferencial
de claves de parámetros → receta de datos → replay sin navegador. Requiere dos
valores discriminantes por parámetro y rechaza evidencia insuficiente/ambigua.
No infiere intenciones de negocio desde enlaces ni del texto de una página.

## Catálogos y contratos

| Ámbito | Workflow | Efecto | Verificación |
|---|---|---|---|
| USGAR real | `search_usgar_rooms` | Lectura | Esquema, fechas/noches, totales y calendario por noche |
| UVCV real (sesión) | `uvcv_list_courses` | Lectura | AJAX Moodle, IDs únicos y matrícula |
| UVCV real (sesión) | `uvcv_get_course` | Lectura | Curso matriculado → `core_courseformat_get_state`; secciones/módulos |
| UVCV real (sesión) | `uvcv_list_assignments` | Lectura | Filtro `assign` sobre el estado del curso |
| UVCV real (sesión) | `uvcv_get_grades` | Lectura | Página de notas ↔ definiciones de ítems; IDs y duplicados |
| UVCV real (sesión) | `uvcv_upcoming_events` | Lectura | Calendario ordenado, IDs únicos y truncación explícita |
| Demoblaze demo | `lookup_demoblaze_phone` | Lectura | Categoría → título → ID → ficha; atributos y capturas |
| Automation Exercise demo | `search_automation_products` | Lectura | Catálogo → búsqueda; IDs/atributos, nombre o categoría y capturas |
| Laboratorio | `search_products` | Lectura | Filtro, límites, SKU, vacío y esquema |
| Laboratorio | `get_cart` | Lectura | SKU únicos y subtotal aritmético |
| Laboratorio | `add_to_cart` | Escritura ficticia | Estado antes/después, cantidad, otros SKU intactos, respuesta y archivo persistido en tests |

Un proceso expone un solo catálogo. Predeterminado: tres lecturas públicas; si
existe `.local/uvcv-session.json` y el informe `evidence/uvcv-validation.json`
coincide con el hash de `src/uvcv.mjs`, se añaden cinco lecturas UVCV y el scope
pasa a `verified_reads`. Si la sesión existe pero el informe falta o no coincide,
el arranque falla con `CATALOG_NOT_VERIFIED`. SauceDemo queda fuera: su recorrido
observado no aportó una API reproducible. Esto no demuestra inexistencia de otras
APIs. Laboratorio: únicamente al configurar `WEB2API_RECIPE`. Los schemas alimentan
MCP y OpenAPI; la API usa los mismos validadores y runners. Los resultados no
serializan configuración ni secretos. `src/mcp.mjs` expone el catálogo completo;
`src/mcp-uvcv.mjs` expone solo las cinco tools UVCV por stdio y comparte el
registro con `src/mcp-core.mjs`. `npm run build` produce `dist/mcp-uvcv.mjs`
autocontenido.

WhatsApp no es un workflow HTTP y no entra en ese catálogo. `src/mcp-whatsapp.mjs`
abre un socket multidispositivo con las credenciales de un dispositivo vinculado
por la persona y expone `whatsapp_status`, `whatsapp_list_chats`,
`whatsapp_get_messages` y `whatsapp_search_messages`. No envía mensajes,
presencia ni confirmaciones de lectura y no descarga multimedia. La instantánea
se guarda en un JSON local junto a las credenciales (1000 chats, 200 mensajes
por chat) y el MCP la carga al arrancar. Es un cliente no oficial: no se presenta
como API de Meta ni se incluye en el paquete sin dependencias.

El adapter real fija origen y rutas observadas; el usuario no puede aportar URLs.
El runner de recetas solo admite loopback HTTP, rutas absolutas locales y GET/POST
según efecto. Las recetas no ejecutan JavaScript, no contienen cookies/tokens y no
son una capacidad de fetch arbitrario. El arranque compara la receta/código del
adapter con un hash en el informe validado. Es una defensa ante desajustes locales,
no una firma ni una autorización para cargar recetas ajenas sin revisión.

## Aceptación y evidencia

Una respuesta 200 no basta. `search_usgar_rooms` exige que los días del calendario
cubran la estadía y que su mínimo de inventario coincida con las habitaciones.
Comprueba noches y total estándar. El filtro por huéspedes no cotiza suplementos.
`availability_confirmed=false`: ambos endpoints pertenecen al mismo hotel y
podrían compartir errores; no se ha verificado PMS, impuestos ni reserva efectiva.

La batería local repite 75 llamadas HTTP en tres sesiones y comprueba 17 casos
negativos/de protocolo. Un falso éxito inyectado debe devolver `EFFECT_UNVERIFIED`.
La batería real usa dos rangos de fechas y ocupaciones, con consulta MCP desde
otro proceso y REST autenticado. El reporte registra cada consulta y timestamp.
No se extrapola el éxito del laboratorio a otros sitios ni se trata cada llamada
correlacionada como una muestra independiente para un intervalo estadístico.

`evidence/uvcv-validation.json` acredita cinco lecturas reales con la sesión
autorizada: cursos, estado del curso, tareas, notas y calendario. Comprueba IDs
únicos, secciones/módulos no vacíos, filas de notas contrastadas con las
definiciones y orden/truncación de eventos. No guarda nombres, notas ni cookies.
La expiración se prueba con respuestas simuladas (redirección, 401/403, 429), no
esperando a que venza la sesión real. Renovar el login exige `npm run uvcv:login`;
modificar el adapter exige `npm run uvcv:validate` y actualiza el hash.
`npm run uvcv:keepalive` mantiene la sesión con `core_session_touch` cada 20
minutos mientras el proceso vive; no cambia el plazo del servidor ni la cookie.

La instantánea de WhatsApp se prueba con mensajes sintéticos: texto, pie de foto,
grupos, deduplicación, límites, orden y búsqueda. `npm run whatsapp:validate`
generó `evidence/whatsapp-validation.json` tras una vinculación real (1000 chats,
6480 mensajes) y comprobó orden, pertenencia, búsqueda y rechazo de entrada
inválida; guarda conteos, sin JIDs, nombres de chat ni cuerpos de mensajes. El
riesgo de restricción de cuenta por usar un cliente no oficial no se puede
eliminar con pruebas.

La evaluación adicional usa siete escenarios UI/API: tres teléfonos y cuatro
búsquedas de ropa. Solo cinco sirven para compilar; Nexus 6 y `tshirt` se
reservan. Se valida el producto ausente/array vacío y se rechaza SauceDemo.
Se inspeccionaron visualmente listas y fichas; en Automation Exercise las imágenes
de producto no cargaron en algunas capturas, por lo que esa revisión solo acredita
texto, categoría y precio visibles. La UI la comprueba el agente; el runtime no
utiliza visión. No se ejecutaron escrituras externas ni checkout.

Estados de evidencia: observado en UI/red (E2/E3), replay semántico probado (E4).
E4 acredita esas llamadas y aserciones, no verdad absoluta del estado del hotel.
Errores de contrato/inventario, rate limit o red detienen el workflow; no se
publica un resultado degradado como válido. Las recetas de laboratorio requieren
el informe pasado para exponerse. Modificar el adapter real exige revalidarlo.

## Decisiones

- **Adapter pequeño en lugar de incorporar Imprint/Writ:** asegura ejecución HTTP
  estricta y reduce dependencias operativas; el coste es descubrimiento manual
  por sitio y sin ecosistema de sesiones/reparación. No se copió código de ellos.
- **Navegador solo como herramienta de descubrimiento:** Playwright queda fuera
  del bundle MCP. Permite inspección y tests sin introducirlo en el runtime.
- **Bundle Node local:** SDK MCP y Zod se empaquetan con esbuild para que el plugin
  funcione sin instalar dependencias dentro de la caché de Codex. Node 24 sigue
  siendo un requisito explícito; no se añade un servidor cloud.
- **Fallo ante discrepancia de inventario:** puede rechazar un cambio legítimo
  entre dos lecturas; se prefiere informar la inconsistencia a inventar certeza.

## Herramientas evaluadas

| Herramienta | Uso y decisión | Evidencia/límite |
|---|---|---|
| [Playwright](https://playwright.dev/docs/network) 1.64.1, Apache-2.0 | Adoptado solo para descubrimiento/tests | Captura real de USGAR y laboratorio. No infiere semántica. |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) 1.32.1, MIT | Adoptado para stdio y cliente independiente | Handshake, listTools y callTool reales. No verifica el negocio. |
| [Baileys](https://github.com/WhiskeySockets/Baileys) 6.7.24, MIT | Adoptado como cliente multidispositivo de solo lectura para WhatsApp | Vinculación por QR y credenciales locales. Cliente no oficial; no es una API de Meta, no garantiza historial completo y puede exponer la cuenta a restricción. |
| [Imprint](https://github.com/ashaychangwani/imprint) | Referencia conceptual; no incorporado | Su README describe captura, compilación y varios transports. No se ejecutó aquí ni se reutilizó código/licencia. |
| [Writ](https://github.com/usewrit/writ) | Referencia conceptual; no incorporado | Describe workflows de navegador y REST/MCP. No prueba HTTP-only por operación. No se ejecutó aquí ni se reutilizó código/licencia. |

Versiones y licencias adoptadas se fijan en package-lock.json. npm audit se ejecutó
al instalar, pero ese resultado no sustituye revisión de código ni pruebas.
Las referencias de productos no se usan como evidencia de capacidades de USGAR.

## Fuera del alcance y siguiente puerta

No implementados: exploración general autónoma durante días, proveedor de modelos,
multiusuario, almacén de credenciales del sistema, rotación/revocación automática,
reparación automática, writes reales, reservas y pagos. En WhatsApp no se
implementan envíos, presencia, recibos de lectura, descarga de multimedia ni
historial completo; la instantánea es una copia local acotada, no un archivo
completo. La sesión UVCV es de un
solo usuario y vive en un archivo local; no es un vault multiusuario. Existe
instalación local por CLI y prueba de su proceso MCP; no existe publicación
pública ni prueba de invocación desde la interfaz de un chat nuevo. No se cambia
el plugin Web2API Forge instalado anteriormente.

La siguiente fase debe automatizar la elección de acciones y objetivos de
exploración, que todavía requiere al agente. Debe entregar únicamente URL y
objetivo, ocultar los endpoints al descubridor, separar al evaluador y medir
operaciones útiles publicadas, falsos éxitos, coste/tiempo e intervenciones.
Las escrituras reales necesitan un entorno de prueba y verificación independiente
autorizada antes de ampliar el catálogo. Las metas originales de 5 workflows y
95% de éxito universal no son capacidades demostradas por este piloto.
