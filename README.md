# Web2API · de un enlace a una API

**La idea.** Le das un enlace. La caja mágica observa esa web, destila sus
operaciones en workflows tipados, los valida contra casos que no vio y los
empaqueta como una API propia: OpenAPI, REST y MCP. El resultado se invoca como
cualquier API, sin escribir la integración a mano y sin navegador en tiempo de
ejecución.

No es un scraper que copia HTML. Cada workflow es un JSON declarativo con
parámetros, dependencias entre pasos y comprobaciones. El motor solo ejecuta
operaciones de lectura revisadas y verifica la respuesta antes de publicarla.

## Cómo funciona

1. **Descubrir** — un worker aislado abre la web pública, registra el tráfico
   JSON y las operaciones de lectura observadas.
2. **Compilar** — `src/read-workflow.mjs` infiere parámetros, IDs dependientes,
   esquemas y reglas de búsqueda a partir de demostraciones, no de rutas
   hardcodeadas por sitio.
3. **Validar** — el caso reservado se ejecuta por HTTP y se contrasta con la
   evidencia. Si falla, el workflow no se guarda.
4. **Servir** — el catálogo se publica por REST, MCP y UI. La ejecución usa solo
   HTTP: sin visión, sin clics y sin llamadas a un modelo.

## Demo

Requiere Node 24.x.

```bash
npm ci --ignore-scripts
npm start
```

Abre `http://127.0.0.1:4319`. Para presentar sin Internet:

```bash
npm run studio:demo
```

Abre `http://127.0.0.1:4320` con tres productos ficticios, precios PEN y un
carrito temporal. El arranque observa la API local e infiere su receta; cada
ejecución posterior hace HTTP real. Una escritura requiere confirmación y se
comprueba releyendo el carrito. No hay pagos ni datos reales.

## API

```bash
GET  /v1/catalog
POST /v1/workflows/{workflow_id}
```

Ambas rutas aceptan `Authorization: Bearer <WEB2API_API_KEY>` cuando el cliente
no es la UI local. El servidor escucha solo en loopback. `openapi.json` describe
el contrato completo. Los errores tienen código estable (`INVALID_INPUT`,
`UPSTREAM_CHANGED`, `REAUTH_REQUIRED`, `VERIFICATION_FAILED`, …) y no exponen
detalles del upstream ni secretos.

## Estructura

- `src/` — motor: catálogo, compilador, contratos, red y adaptadores.
- `web/` — interfaz del Workflow Studio.
- `scripts/` — build, demos y validaciones ejecutables.
- `test/` — contratos sintéticos y pruebas del motor.
- `recipes/` — workflows ya compilados, sin código ni credenciales.
- `evidence/` — informes de validación fechados que el catálogo verifica.
- `plugin.json`, `mcp.json`, `skills/` — consumo desde MCP y Codex.

## Límites

El descubrimiento es **asistido y acotado**: observa una URL HTTPS pública y
requiere revisar las operaciones antes de compilar. No es un descubridor
universal autónomo. No se resuelven CAPTCHA, no se rotan proxies y no se evaden
controles de acceso. Las escrituras exigen confirmación explícita.

Las integraciones UVCV (Moodle) y WhatsApp son de solo lectura. WhatsApp usa un
cliente no oficial y puede infringir sus términos. La API de USGAR no se ha
identificado como contrato público estable: si cambia, el workflow falla y pide
revisión, no reparación automática.

## Documentación

- [AUTHENTICATION.md](AUTHENTICATION.md) — sesiones autenticadas y cookies.
- [SDD.md](SDD.md) — alcance implementado y siguiente fase.
- [MULTISITE_REPORT.md](MULTISITE_REPORT.md) — validación en sitios reales.
- [SOCIAL_REPORT.md](SOCIAL_REPORT.md) — X y WhatsApp.

## Calidad

```bash
npm test
npm run test:studio
npm run build
npm run check
```

`test:studio` maneja la interfaz con Chromium. `build` genera el paquete
autocontenido en `artifacts/web2api-app` y actualiza `openapi.json`.
