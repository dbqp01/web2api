import { workflowMeta, displayName, inputValues, defaultValue, curlRequest, resultRows, captureSummary } from './studio.js';

const $ = selector => document.querySelector(selector);
const messages = {
  INVALID_INPUT: 'Revisa los parámetros del formulario.', INVALID_CAPTURE: 'La captura no tiene el formato esperado.',
  NO_MATCH: 'No se encontró un registro con ese nombre exacto.', SEARCH_INCOMPLETE: 'La búsqueda no coincide con el catálogo completo.',
  UPSTREAM_REJECTED: 'La fuente rechazó la consulta.', UPSTREAM_CHANGED: 'La fuente cambió su contrato. Hay que volver a validarlo.',
  VERIFICATION_FAILED: 'La respuesta no pasó las comprobaciones.', EFFECT_UNVERIFIED: 'No se pudo comprobar el efecto. Consulta el carrito antes de repetir.',
  UPSTREAM_CONFLICT: 'La fuente rechazó el cambio por un conflicto. Revisa el estado actual.',
  UPSTREAM_UNAVAILABLE: 'La fuente no está disponible. Puedes volver a intentarlo.', UPSTREAM_TIMEOUT: 'La fuente no respondió a tiempo.',
  AUTH_EXPIRED: 'La sesión de la fuente venció. Reconecta desde Conexiones.', REAUTH_REQUIRED: 'La sesión venció. Repite el inicio de sesión.',
  SESSION_NOT_CONFIGURED: 'Falta configurar la sesión. Consulta Conexiones.', SESSION_NOT_READY: 'La sesión todavía no está preparada.',
  UNSUPPORTED_OPERATION: 'La fuente no admite esta operación.', RATE_LIMITED: 'La fuente limitó las consultas. No se reintentó.',
  DUPLICATE_WORKFLOW: 'Ese identificador ya existe. Usa otro nombre para el workflow.', WORKFLOW_LIMIT: 'Se alcanzó el límite de 20 workflows aprendidos.',
  UNAUTHORIZED: 'Recarga la app para renovar su sesión local.', REQUEST_FAILED: 'No se pudo completar la solicitud.', NETWORK_ERROR: 'Se perdió la conexión con el backend. Comprueba que siga abierto.',
  HELD_OUT_INPUT_REQUIRED: 'Incluye una evaluación distinta de las demostraciones.', EVALUATION_MISMATCH: 'La respuesta no coincide con la evidencia reservada.',
  BODY_TOO_LARGE: 'El archivo supera el límite de 1 MB.', WORKFLOW_BUSY: 'Hay otra validación o ejecución en curso.',
  BROWSER_SETUP_REQUIRED: 'Instala Chromium con npx playwright install chromium y vuelve a intentarlo.',
  DISCOVERY_WORKER_UNAVAILABLE: 'Falta preparar el descubridor. Ejecuta npm run build y vuelve a iniciar la app.',
  DISCOVERY_WORKER_STOPPED: 'El proceso de descubrimiento se detuvo. Comprueba la instalación de Chromium.',
  CATALOG_NOT_DISCOVERED: 'No se encontró un catálogo JSON compatible con los enlaces visibles.', DETAIL_API_NOT_DISCOVERED: 'No se encontró una API de ficha compatible.',
  DISCOVERY_BUSY: 'Ya hay un descubrimiento en curso.', DISCOVERY_TIMEOUT: 'El descubrimiento agotó el tiempo disponible.',
  ORIGIN_REJECTED: 'La URL no cumple la política de acceso público HTTPS.', OPERATION_REVIEW_REQUIRED: 'Revisa y confirma primero las operaciones de lectura.',
  UNREVIEWED_OPERATION: 'Hay operaciones que no están autorizadas como lectura.', SESSION_TRANSPORT_REQUIRED: 'Esta fuente necesita un transporte autenticado compatible.',
  NOT_FOUND: 'El recurso ya no está disponible. Actualiza el catálogo.', EVALUATION_FAILED: 'No se pudo validar el recorrido observado.',
};
const viewNames = { workspace: 'Workflows', discover: 'Descubrir', learn: 'Importar evidencia', history: 'Historial', connections: 'Conexiones', guide: 'Guía de presentación' };
const labels = { check_in: 'Llegada', check_out: 'Salida', product_name: 'Nombre exacto', query: 'Búsqueda', guests: 'Huéspedes', max_results: 'Máximo de resultados', courseid: 'ID del curso', sku: 'SKU del producto', quantity: 'Cantidad', confirmed: 'Confirmación', name: 'Nombre', title: 'Nombre', price: 'Precio', price_cents: 'Precio', subtotal_cents: 'Subtotal', currency: 'Moneda', total: 'Total', truncated: 'Resultado truncado', id: 'ID', brand: 'Marca', category: 'Categoría', capacity: 'Capacidad', available: 'Disponible' };
let workflows = [], scope, selected, capture, busy = false, lastResult, pendingDiscoveryOperations = [], history = [], toastTimer;
let connectionsLoaded = false, currentView = 'workspace';
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const icon = name => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.setAttribute('class', 'icon'); el.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(el.namespaceURI, 'use'); use.setAttribute('href', `/icons.svg#${name}`); el.append(use); return el; };
const errorText = error => `${messages[error.message] || 'No se pudo completar la operación.'} (${error.message})`;
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copiado al portapapeles.'); } catch { toast('No se pudo copiar. Selecciona el texto y cópialo manualmente.'); } }
async function api(path, body) {
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); }
  catch { throw new Error('NETWORK_ERROR'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('REQUEST_FAILED'); }
  if (!response.ok) throw new Error(result.error?.code || 'REQUEST_FAILED');
  return result;
}
function route() {
  const requested = location.hash.slice(1) || 'workspace'; currentView = Object.hasOwn(viewNames, requested) ? requested : 'workspace';
  document.querySelectorAll('[data-view]').forEach(el => { el.hidden = el.dataset.view !== currentView; });
  document.querySelectorAll('[data-nav]').forEach(el => { if (el.dataset.nav === currentView) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('#breadcrumb').textContent = viewNames[currentView]; document.title = `${viewNames[currentView]} · Web2API`;
  $('#sidebar').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false');
  if (currentView === 'history') renderHistory();
  if (currentView === 'connections' && !connectionsLoaded) loadConnections();
}
window.addEventListener('hashchange', route);
$('#menu-toggle').onclick = () => { const open = $('#sidebar').classList.toggle('open'); $('#menu-toggle').setAttribute('aria-expanded', String(open)); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { $('#sidebar').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); }
  if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); location.hash = 'workspace'; $('#workflow-search').focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && currentView === 'workspace' && selected && !busy) { event.preventDefault(); $('#run-form').requestSubmit(); }
});
function setBusy(value) {
  busy = value;
  $('#run-button').disabled = value || !selected;
  $('#learn-button').disabled = value || !capture || !$('#reviewed').checked;
  for (const selector of ['#load-example', '#capture-file', '#reviewed', '#discover-button', '#discover-url', '#discover-task', '#discover-category', '#discover-id', '#discover-reviewed', '#reset-fields', '#refresh-catalog']) $(selector).disabled = value;
  document.querySelectorAll('#fields input, #fields select, #fields textarea, .workflow-card').forEach(el => { el.disabled = value; });
  $('#run-form').setAttribute('aria-busy', String(value));
}
function readInput() {
  if (!selected) return {};
  const values = {};
  for (const el of $('#fields').querySelectorAll('[name]')) values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return inputValues(selected.input_schema?.properties || {}, values, selected.input_schema?.required || []);
}
function updateRequest() {
  if (!selected) return;
  try { $('#request-code').textContent = curlRequest(location.origin, selected.id, readInput()); } catch { $('#request-code').textContent = 'Corrige los parámetros para generar la solicitud.'; }
}
function resetResult() {
  lastResult = null; $('#copy-result').disabled = true; $('#download-result').disabled = true;
  $('#duration').textContent = ''; $('#result').textContent = 'Todavía no hay una respuesta.';
  $('#evidence').textContent = 'Las fuentes y verificaciones aparecerán después de ejecutar.';
  $('#response-meta').textContent = 'La respuesta se valida antes de mostrarse.';
  const empty = node('div', undefined, 'empty-result'); empty.append(icon('terminal'), node('h3', 'Una llamada. Su evidencia.'), node('p', 'Ejecuta el workflow para ver la respuesta y las comprobaciones del backend.'));
  $('#result-preview').replaceChildren(empty); showTab('result');
}
function choose(workflow, preset) {
  selected = workflow;
  document.querySelectorAll('.workflow-card').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.workflow === workflow.id)));
  const meta = workflowMeta(workflow, scope);
  $('#workflow-source').textContent = meta.source; $('#workflow-title').textContent = displayName(workflow.id);
  $('#workflow-description').textContent = workflow.description;
  $('#workflow-route').textContent = `/v1/workflows/${workflow.id}`;
  $('#effect-tag').textContent = workflow.effect === 'write' ? 'Escritura · demo' : 'Solo lectura'; $('#effect-tag').className = `tag ${workflow.effect === 'write' ? 'write' : 'read'}`;
  $('#execution-note').textContent = workflow.effect === 'write' ? 'Confirma el cambio en el carrito ficticio.' : 'Ejecución HTTP · sin llamadas al modelo';
  $('#fields').replaceChildren();
  for (const [name, schema] of Object.entries(workflow.input_schema?.properties || {})) {
    const label = node('label', labels[name] || name.replaceAll('_', ' '));
    let input;
    if (schema.type === 'boolean') {
      label.textContent = ''; label.className = 'check-label'; input = node('input'); input.type = 'checkbox';
      label.append(input, node('span', name === 'confirmed' ? 'Confirmo añadir esta cantidad al carrito ficticio. No se realizará ningún pago.' : labels[name] || name));
      input.required = schema.const === true; input.checked = false;
    } else {
      if (schema.enum) { input = node('select'); for (const value of schema.enum) { const opt = node('option', String(value)); opt.value = String(value); input.append(opt); } }
      else if (['array', 'object'].includes(schema.type)) { input = node('textarea'); label.classList.add('wide-field'); }
      else { input = node('input'); input.type = ['integer', 'number'].includes(schema.type) ? 'number' : schema.format === 'date' ? 'date' : 'text'; }
      input.required = !!workflow.input_schema.required?.includes(name) && (schema.type !== 'string' || !!schema.minLength || !!schema.pattern || !!schema.format);
      if (schema.minimum !== undefined) input.min = schema.minimum;
      if (schema.maximum !== undefined) input.max = schema.maximum;
      if (schema.maxLength !== undefined) input.maxLength = schema.maxLength;
      if (schema.minLength !== undefined) input.minLength = schema.minLength;
      if (input.type === 'number') input.step = schema.type === 'integer' ? '1' : 'any';
      const value = preset?.[name] ?? defaultValue(name, schema, workflow.id);
      input.value = typeof value === 'object' ? JSON.stringify(value) : value;
      if (schema.pattern) {
        // JSON Schema regexes use JavaScript syntax; HTML patterns now use the different v flag.
        const pattern = new RegExp(schema.pattern);
        const validate = () => input.setCustomValidity(input.value && !pattern.test(input.value) ? 'El valor no cumple el formato esperado.' : '');
        input.addEventListener('input', validate); validate();
      }
      label.append(input);
    }
    input.name = name; input.autocomplete = 'off'; input.addEventListener('input', updateRequest); $('#fields').append(label);
    if (name === 'sku') input.placeholder = 'coffee, tea o cup';
    if (name === 'courseid') input.placeholder = 'Copia un ID desde Mis cursos';
  }
  if (!Object.keys(workflow.input_schema?.properties || {}).length) $('#fields').append(node('p', 'Este workflow no requiere parámetros.', 'field-help'));
  $('#run-status').textContent = 'Listo para ejecutar.'; $('#run-status').dataset.state = 'ready';
  $('#copy-request').disabled = false; resetResult(); updateRequest(); setBusy(busy);
}
function renderCatalog() {
  const query = $('#workflow-search').value.toLocaleLowerCase('es').trim(), filter = $('#workflow-filter').value;
  const visible = workflows.filter(workflow => { const meta = workflowMeta(workflow, scope); return (filter === 'all' || meta.group === filter) && `${displayName(workflow.id)} ${workflow.id} ${meta.source} ${workflow.description}`.toLocaleLowerCase('es').includes(query); });
  $('#workflow-count').textContent = `${visible.length} de ${workflows.length}`; $('#workflows').replaceChildren();
  for (const workflow of visible) {
    const meta = workflowMeta(workflow, scope), card = node('button', undefined, 'workflow-card'); card.type = 'button'; card.dataset.workflow = workflow.id; card.disabled = busy; card.setAttribute('aria-pressed', String(selected?.id === workflow.id));
    const top = node('div', undefined, 'card-site'); top.append(node('span', meta.short), icon('arrow'));
    const bottom = node('div', undefined, 'card-bottom'); bottom.append(icon(workflow.effect === 'write' ? 'lock' : 'shield'), node('span', workflow.effect === 'write' ? 'Confirmación requerida' : 'Lectura verificada'), node('span', 'HTTP'));
    card.append(top, node('strong', displayName(workflow.id)), bottom); card.onclick = () => { if (!busy) choose(workflow); }; $('#workflows').append(card);
  }
  if (!visible.length) { const empty = node('div', undefined, 'empty-list'); empty.append(node('strong', workflows.length ? 'Sin coincidencias' : 'Tu catálogo está vacío'), node('p', workflows.length ? 'Prueba otro nombre o cambia el origen.' : 'Descubre un catálogo público o importa evidencia revisada para crear un workflow.')); $('#workflows').append(empty); }
}
async function refresh(preferred) {
  $('#refresh-catalog').disabled = true;
  try {
    const catalog = await api('/v1/catalog'); workflows = catalog.workflows; scope = catalog.scope;
    $('#demo-notice').hidden = scope !== 'controlled_lab_only'; $('#environment').textContent = scope === 'controlled_lab_only' ? 'Laboratorio local' : 'Entorno local';
    $('#backend-status').textContent = 'Backend conectado'; $('#backend-dot').dataset.state = 'ready';
    $('#catalog-status').textContent = scope === 'controlled_lab_only' ? 'Contratos del laboratorio ficticio' : 'Contratos disponibles para ejecutar';
    renderCatalog();
    const next = workflows.find(workflow => workflow.id === (preferred || selected?.id)) || workflows.find(workflow => workflow.id === 'lookup_demoblaze_phone') || workflows[0];
    if (next) choose(next); else { selected = undefined; $('#run-button').disabled = true; }
  } catch (error) {
    $('#catalog-status').textContent = errorText(error); $('#backend-status').textContent = 'Sin conexión'; $('#backend-dot').dataset.state = 'error';
    if (!workflows.length) $('#workflows').replaceChildren(node('p', 'Usa Actualizar catálogo para volver a conectar.', 'empty-list'));
  } finally { $('#refresh-catalog').disabled = busy; }
}
$('#workflow-search').addEventListener('input', renderCatalog); $('#workflow-filter').addEventListener('change', renderCatalog);
$('#refresh-catalog').onclick = () => refresh(); $('#reset-fields').onclick = () => { if (selected && !busy) choose(selected); };
function showTab(name) {
  document.querySelectorAll('[data-result-tab]').forEach(el => { const active = el.dataset.resultTab === name; el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1; $(`#panel-${el.dataset.resultTab}`).hidden = !active; });
}
const tabs = [...document.querySelectorAll('[data-result-tab]')];
for (const tab of tabs) { tab.onclick = () => showTab(tab.dataset.resultTab); tab.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; showTab(tabs[index].dataset.resultTab); tabs[index].focus(); }; }
function format(value, key, currency) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') {
    if (key.endsWith('_cents') && currency && /^[A-Z]{3}$/.test(currency)) { try { return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value / 100); } catch { /* Unknown currency remains a raw value with units. */ } }
    return `${value.toLocaleString('es-PE')}${key.endsWith('_cents') ? ' centavos' : ''}`;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function renderResult(data) {
  const container = $('#result-preview'); container.replaceChildren(); const rows = resultRows(data);
  if (rows) {
    if (!rows.length) container.append(node('p', 'La consulta terminó correctamente y no devolvió registros.', 'empty-list'));
    else {
      const objects = rows.map(value => value && typeof value === 'object' && !Array.isArray(value) ? value : { valor: value });
      const keys = [...new Set(objects.flatMap(value => Object.keys(value)))], columns = keys.slice(0, 6);
      const table = node('table'), thead = node('thead'), header = node('tr');
      for (const key of columns) { const numeric = objects.some(row => typeof row[key] === 'number'); const th = node('th', labels[key] || key.replaceAll('_', ' '), numeric ? 'num' : undefined); th.scope = 'col'; header.append(th); }
      thead.append(header); table.append(thead); const tbody = node('tbody');
      for (const row of objects.slice(0, 50)) { const tr = node('tr'); for (const key of columns) { const value = row[key]; tr.append(node('td', format(value, key, data?.currency), typeof value === 'number' ? 'num' : undefined)); } tbody.append(tr); }
      table.append(tbody); const wrap = node('div', undefined, 'result-table-wrap'); wrap.append(table); container.append(wrap);
      if (rows.length > 50 || keys.length > 6) container.append(node('p', `Vista previa: ${Math.min(rows.length, 50)} de ${rows.length} registros, ${columns.length} de ${keys.length} campos. El JSON contiene la respuesta completa.`, 'result-summary'));
    }
    const facts = data && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([, value]) => !Array.isArray(value))) : {};
    if (Object.keys(facts).length) { const summary = node('p', Object.entries(facts).map(([key, value]) => `${labels[key] || key.replaceAll('_', ' ')}: ${format(value, key, data.currency)}`).join(' · '), 'result-summary'); container.append(summary); }
  } else if (data && typeof data === 'object') {
    const list = node('dl', undefined, 'result-details');
    for (const [key, value] of Object.entries(data)) { const term = node('dt', labels[key] || key.replaceAll('_', ' ')), definition = node('dd'); if (value && typeof value === 'object') definition.append(node('pre', JSON.stringify(value, null, 2))); else definition.textContent = format(value, key, data.currency); list.append(term, definition); }
    container.append(Object.keys(data).length ? list : node('p', 'La fuente devolvió un objeto vacío.', 'empty-list'));
  } else container.append(node('p', format(data, '', ''), 'result-summary'));
}
function displayResponse(result, ms, timestamp) {
  lastResult = result; $('#result').textContent = JSON.stringify(result.data, null, 2); $('#evidence').textContent = JSON.stringify(result.evidence ?? {}, null, 2);
  renderResult(result.data); $('#duration').textContent = `${ms.toLocaleString('es-PE')} ms`; $('#copy-result').disabled = false; $('#download-result').disabled = false;
  $('#response-meta').textContent = `HTTP · ${new Date(timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}
$('#run-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !selected) return;
  let input; try { input = readInput(); } catch (error) { $('#run-status').textContent = errorText(error); $('#run-status').dataset.state = 'error'; return; }
  const workflow = selected, start = performance.now(), timestamp = new Date().toISOString();
  resetResult(); setBusy(true); $('#run-button span').textContent = 'Ejecutando…'; $('#run-status').dataset.state = 'running'; $('#run-status').textContent = 'Consultando la fuente y verificando la respuesta…';
  $('#result-preview').replaceChildren(node('p', 'Esperando la respuesta HTTP…', 'empty-list'));
  try {
    const result = await api(`/v1/workflows/${workflow.id}`, input), ms = Math.round(performance.now() - start);
    displayResponse(result, ms, timestamp); $('#run-status').textContent = 'Completado. Las comprobaciones del workflow pasaron.'; $('#run-status').dataset.state = 'success';
    history.unshift({ workflow, input, result, ms, timestamp });
  } catch (error) {
    const ms = Math.round(performance.now() - start); $('#duration').textContent = `${ms} ms`; $('#run-status').textContent = errorText(error); $('#run-status').dataset.state = 'error';
    $('#result-preview').replaceChildren(node('p', workflow.effect === 'write' ? 'Consulta el estado del carrito antes de volver a confirmar una escritura.' : 'No se presenta como válida una respuesta sin verificar. Revisa los parámetros o vuelve a intentarlo.', 'empty-list'));
    $('#result').textContent = JSON.stringify({ error: { code: error.message } }, null, 2); history.unshift({ workflow, input, error: error.message, ms, timestamp });
  } finally { history = history.slice(0, 30); $('#run-button span').textContent = 'Ejecutar workflow'; setBusy(false); if (currentView === 'history') renderHistory(); }
});
$('#copy-request').onclick = () => { try { copy(curlRequest(location.origin, selected.id, readInput())); } catch { toast('Corrige los parámetros antes de copiar.'); } };
$('#copy-result').onclick = () => { if (lastResult) copy(JSON.stringify(lastResult, null, 2)); };
$('#download-result').onclick = () => {
  if (!lastResult) return; const url = URL.createObjectURL(new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = `${selected.id}-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Respuesta y evidencia descargadas.');
};
function renderHistory() {
  const list = $('#history-list'); list.replaceChildren(); $('#clear-history').disabled = !history.length;
  if (!history.length) { const empty = node('div', undefined, 'empty-list'); empty.append(node('strong', 'Aún no hay ejecuciones'), node('p', 'Ejecuta un workflow y encontrarás aquí su resultado, duración y evidencia. Conservamos las últimas 30 llamadas de esta pestaña.')); list.append(empty); }
  for (const entry of history) {
    const row = node('article', undefined, 'history-row'), identity = node('div'); identity.append(node('strong', displayName(entry.workflow.id)), node('small', entry.error ? errorText(new Error(entry.error)) : 'Comprobaciones completadas'));
    const time = node('time', new Date(entry.timestamp).toLocaleTimeString('es-PE')); time.dateTime = entry.timestamp;
    const action = node('button', 'Abrir', 'text-button'); action.disabled = busy; action.onclick = () => { if (busy) return; choose(entry.workflow, entry.input); if (entry.result) { displayResponse(entry.result, entry.ms, entry.timestamp); $('#run-status').textContent = 'Resultado guardado de esta pestaña. No se ha ejecutado de nuevo.'; $('#run-status').dataset.state = 'success'; } else { $('#run-status').textContent = errorText(new Error(entry.error)); $('#run-status').dataset.state = 'error'; } location.hash = 'workspace'; };
    const actions = node('div', undefined, 'history-actions'); actions.append(action); row.append(identity, time, node('span', `${entry.ms} ms`, 'num'), actions); list.append(row);
  }
}
$('#clear-history').onclick = () => { history = []; renderHistory(); toast('Historial de la pestaña vaciado.'); };
function review(raw) {
  const summary = captureSummary(raw); capture = raw; $('#reviewed').checked = false; $('#learn-button').disabled = true; $('#learn-open').hidden = true;
  $('#capture-review').textContent = JSON.stringify(summary, null, 2); $('#learn-status').textContent = 'Revisa los destinos y confirma las operaciones antes de validar.'; $('#learn-status').dataset.state = 'ready';
}
$('#capture-file').addEventListener('change', async event => {
  capture = null; $('#reviewed').checked = false; $('#learn-button').disabled = true;
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 1000000) throw new Error('BODY_TOO_LARGE'); let raw; try { raw = JSON.parse(await file.text()); } catch { throw new Error('INVALID_CAPTURE'); } review(raw); }
  catch (error) { $('#capture-review').textContent = 'La captura no se ha cargado.'; $('#learn-status').textContent = errorText(error); $('#learn-status').dataset.state = 'error'; }
});
$('#load-example').onclick = async () => { setBusy(true); try { review(await api('/examples/learn-laptop.json')); } catch (error) { capture = null; $('#learn-status').textContent = errorText(error); $('#learn-status').dataset.state = 'error'; } finally { setBusy(false); } };
$('#reviewed').onchange = () => setBusy(busy);
$('#learn-button').onclick = async () => {
  if (busy || !capture || !$('#reviewed').checked) return;
  setBusy(true); $('#learn-status').textContent = 'Infiriendo la receta y evaluando los casos por HTTP…'; $('#learn-status').dataset.state = 'running';
  try { const result = await api('/v1/learn', { reviewed: true, capture }); await refresh(result.workflow); $('#learn-status').textContent = `Incorporado: ${result.workflow}. ${result.verification.held_out_inputs.length} caso(s) reservado(s) comprobado(s).`; $('#learn-status').dataset.state = 'success'; $('#learn-open').hidden = false; capture = null; $('#reviewed').checked = false; }
  catch (error) { $('#learn-status').textContent = errorText(error); $('#learn-status').dataset.state = 'error'; }
  finally { setBusy(false); }
};
async function loadConnections() {
  $('#refresh-connections').disabled = true; $('#connections-status').textContent = 'Comprobando configuración local…';
  try {
    const result = await api('/v1/connections'); const list = $('#connections-list'); list.replaceChildren();
    for (const connection of result.connections) {
      const row = node('article', undefined, 'connection-row'), identity = node('div'), title = node('div', undefined, 'connection-title');
      const status = { available: 'Disponible', configured: 'Configurado', setup_required: 'Sin configurar', unavailable: 'No disponible' }[connection.status] || connection.status;
      title.append(node('h2', connection.name), node('span', status, `tag ${connection.status === 'available' ? 'success' : ''}`)); identity.append(title, node('p', connection.interface === 'dedicated_mcp' ? 'MCP dedicado · proceso separado' : 'API REST y MCP', 'connection-transport'));
      const detail = node('div'), notes = node('ul'); for (const limit of connection.limitations || []) notes.append(node('li', limit)); detail.append(notes);
      if (connection.setup_commands?.length) detail.append(node('pre', connection.setup_commands.join('\n')));
      if (connection.workflow_ids?.length) detail.append(node('p', `${connection.workflow_ids.length} workflows en este catálogo.`, 'field-help'));
      row.append(identity, detail); list.append(row);
    }
    connectionsLoaded = true; $('#connections-status').textContent = 'Configuración comprobada. No se han abierto sesiones ni consultado datos personales.'; $('#connections-status').dataset.state = 'ready';
  } catch (error) { $('#connections-status').textContent = errorText(error); $('#connections-status').dataset.state = 'error'; }
  finally { $('#refresh-connections').disabled = false; }
}
$('#refresh-connections').onclick = loadConnections;
for (const id of ['#discover-url', '#discover-category', '#discover-id']) $(id).addEventListener('input', () => { pendingDiscoveryOperations = []; $('#discover-reviewed').checked = false; $('#discover-review-label').hidden = true; });
function rememberJob(id) { try { if (id) sessionStorage.setItem('web2api.discovery', id); else sessionStorage.removeItem('web2api.discovery'); } catch { /* A blocked browser store only disables resuming after reload. */ } }
async function followDiscovery(id) {
  setBusy(true); $('#discovery-open').hidden = true; $('#discovery-state').textContent = 'Observando'; $('#discovery-state').className = 'tag';
  try {
    let job;
    do {
      job = await api(`/v1/discoveries/${id}`);
      $('#discovery-progress').textContent = job.events.map(event => `${event.stage}: ${event.detail}`).join('\n') || 'Preparando el navegador aislado…';
      $('#discovery-state').textContent = job.status === 'evaluating' ? 'Verificando' : 'Observando';
      document.querySelectorAll('.discovery-steps li').forEach((el, index) => { el.className = job.status === 'evaluating' ? index < 2 ? 'complete' : index === 2 ? 'current' : '' : index === 0 ? 'current' : ''; });
      if (['running', 'evaluating'].includes(job.status)) await new Promise(resolve => setTimeout(resolve, 1000));
    } while (['running', 'evaluating'].includes(job.status));
    rememberJob(null);
    if (job.status !== 'verified') {
      if (job.blocked_operations?.length) { pendingDiscoveryOperations = job.blocked_operations; $('#discover-review-label').hidden = false; $('#discover-reviewed').checked = false; $('#discovery-progress').textContent += `\n\nOperaciones pendientes de revisión:\n${JSON.stringify(pendingDiscoveryOperations, null, 2)}`; }
      throw new Error(job.error || 'EVALUATION_FAILED');
    }
    await refresh(job.workflow); $('#discovery-progress').textContent += `\n\nVerificado: ${job.workflow}\n${JSON.stringify(job.cases, null, 2)}`;
    $('#discovery-state').textContent = 'Verificado'; $('#discovery-state').className = 'tag success'; $('#discovery-open').hidden = false;
    document.querySelectorAll('.discovery-steps li').forEach(el => { el.className = 'complete'; }); toast('Workflow validado e incorporado al catálogo.');
  } catch (error) { $('#discovery-progress').textContent += `\n${errorText(error)}`; $('#discovery-state').textContent = 'Requiere atención'; $('#discovery-state').className = 'tag warning'; if (error.message !== 'NETWORK_ERROR') rememberJob(null); }
  finally { setBusy(false); }
}
$('#discover-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (pendingDiscoveryOperations.length && !$('#discover-reviewed').checked) { $('#discovery-progress').textContent += '\nConfirma la revisión de las operaciones bloqueadas.'; return; }
  const request = { url: $('#discover-url').value.trim(), task: $('#discover-task').value, id: $('#discover-id').value.trim(), ...($('#discover-category').value.trim() ? { category: $('#discover-category').value.trim() } : {}), ...(pendingDiscoveryOperations.length ? { reviewed_requests: pendingDiscoveryOperations, reviewed: true } : {}) };
  setBusy(true); $('#discovery-progress').textContent = 'Iniciando el navegador aislado…';
  try { const started = await api('/v1/discoveries', request); rememberJob(started.id); await followDiscovery(started.id); }
  catch (error) { $('#discovery-progress').textContent = errorText(error); $('#discovery-state').textContent = 'Requiere atención'; setBusy(false); }
});
route();
await refresh();
try { const id = sessionStorage.getItem('web2api.discovery'); if (id && /^[a-f0-9-]{36}$/.test(id)) followDiscovery(id); } catch { /* Session storage is optional. */ }
