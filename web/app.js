const $ = selector => document.querySelector(selector);
const messages = {
  INVALID_INPUT: 'Revisa los datos del formulario.', NO_MATCH: 'No hay un registro con ese nombre exacto.',
  SEARCH_INCOMPLETE: 'La búsqueda no coincide con el catálogo: resultado incompleto o duplicado.',
  UPSTREAM_REJECTED: 'El proveedor devolvió un error dentro de su respuesta.', UPSTREAM_CHANGED: 'Cambió el contrato de la web. Se requiere volver a validarlo.',
  VERIFICATION_FAILED: 'Los datos no pasaron las comprobaciones.', AUTH_EXPIRED: 'La sesión del sitio venció. Es necesario reconectarla.',
  RATE_LIMITED: 'El sitio limitó las consultas. No se reintentó.', SESSION_TRANSPORT_REQUIRED: 'Este flujo requiere un ejecutor de sesión que aún no está implementado.',
  DUPLICATE_WORKFLOW: 'Este workflow ya está incorporado.', UNAUTHORIZED: 'Recarga la app para iniciar una nueva sesión local.',
  HELD_OUT_INPUT_REQUIRED: 'Incluye al menos una entrada de evaluación distinta de las demostraciones.', EVALUATION_MISMATCH: 'El replay no coincide con la evidencia esperada.',
  BROWSER_SETUP_REQUIRED: 'Prepara Chromium con el comando de BROWSER_SETUP.txt.', CATALOG_NOT_DISCOVERED: 'No se encontró un catálogo JSON relacionado con enlaces visibles.',
  DETAIL_API_NOT_DISCOVERED: 'No se demostró una API de ficha compatible con este patrón.', DISCOVERY_BUSY: 'Ya hay un descubrimiento en curso.',
  ORIGIN_REJECTED: 'El destino no cumple la política de acceso.', DISCOVERY_TIMEOUT: 'El descubrimiento agotó su tiempo; no se publicó el workflow.',
};
let workflows = [], selected, capture, busy = false, pendingDiscoveryOperations = [];
function setBusy(value) {
  busy = value; $('#run-button').disabled = value || !selected;
  $('#learn-button').disabled = value || !capture || !$('#reviewed').checked;
  for (const selector of ['#load-example', '#capture-file', '#reviewed']) $(selector).disabled = value;
  for (const selector of ['#discover-button', '#discover-url', '#discover-task', '#discover-category', '#discover-id', '#discover-reviewed']) $(selector).disabled = value;
}
async function api(path, body) {
  const response = await fetch(path, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.code || 'REQUEST_FAILED');
  return result;
}
const errorText = error => `${messages[error.message] || 'No se pudo completar la operación.'} (${error.message})`;
function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
function displayName(id) {
  return { search_usgar_rooms: 'Habitaciones por fecha', lookup_demoblaze_phone: 'Encontrar un teléfono', search_automation_products: 'Buscar en el catálogo', lookup_demoblaze_laptop: 'Encontrar un portátil' }[id] || id.replaceAll('_', ' ');
}
function choose(workflow) {
  selected = workflow;
  document.querySelectorAll('.workflow-card').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.workflow === workflow.id)));
  $('#workflow-title').textContent = displayName(workflow.id);
  $('#workflow-description').textContent = workflow.description;
  $('#workflow-route').textContent = `POST /v1/workflows/${workflow.id}`;
  const fields = $('#fields'); fields.replaceChildren();
  const defaults = { product_name: workflow.id.includes('laptop') ? 'MacBook Pro' : 'Nexus 6', query: 'tshirt', guests: 2, max_results: 5 };
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  for (const [name, schema] of Object.entries(workflow.input_schema?.properties || {})) {
    const label = node('label', { check_in: 'Llegada', check_out: 'Salida', product_name: 'Nombre exacto', query: 'Buscar', guests: 'Huéspedes', max_results: 'Máximo de resultados' }[name] || name.replaceAll('_', ' '));
    const input = node('input'); input.name = name;
    input.type = ['integer', 'number'].includes(schema.type) ? 'number' : schema.format === 'date' ? 'date' : 'text';
    input.required = workflow.input_schema.required?.includes(name) || false;
    if (schema.minimum !== undefined) input.min = schema.minimum;
    if (schema.maximum !== undefined) input.max = schema.maximum;
    if (schema.maxLength !== undefined) input.maxLength = schema.maxLength;
    input.value = schema.default ?? defaults[name] ?? '';
    if (input.type === 'date') input.value = new Date(today + (name === 'check_out' ? 17 : 15) * 86400000).toISOString().slice(0, 10);
    label.append(input); fields.append(label);
  }
  $('#run-button').disabled = busy;
  $('#run-status').textContent = 'Listo para ejecutar. No se usa un modelo ni visión.';
  $('#run-status').dataset.state = 'ready'; $('#duration').textContent = '';
  $('#result').textContent = 'La respuesta estructurada aparecerá aquí.';
  $('#evidence').textContent = 'Se adjuntan después de ejecutar.';
}
async function refresh(preferred) {
  const catalog = await api('/v1/catalog'); workflows = catalog.workflows;
  $('#workflow-count').textContent = workflows.length; $('#verified-count').textContent = workflows.length;
  $('#catalog-status').textContent = 'Backend conectado · HTTP';
  $('#workflows').replaceChildren();
  for (const workflow of workflows) {
    const card = node('button', undefined, 'workflow-card'); card.type = 'button'; card.dataset.workflow = workflow.id; card.setAttribute('aria-pressed', 'false');
    const site = workflow.id.includes('usgar') ? 'USGAR' : workflow.id.includes('demoblaze') ? 'DEMOBLAZE' : workflow.id.includes('automation') ? 'AUTOMATION EXERCISE' : 'WORKFLOW APRENDIDO';
    const top = node('div', undefined, 'card-site'); top.append(node('span', site), node('span', '↗'));
    const bottom = node('div', undefined, 'card-bottom'); bottom.append(node('span', 'Lectura · contrato validado'), node('span', 'API'));
    card.append(top, node('strong', displayName(workflow.id)), node('p', workflow.description), bottom);
    card.onclick = () => { if (!busy) choose(workflow); }; $('#workflows').append(card);
  }
  if (workflows.length) choose(workflows.find(workflow => workflow.id === preferred) || workflows.find(workflow => workflow.id === 'lookup_demoblaze_phone') || workflows[0]);
}
$('#run-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !selected) return;
  const input = {};
  for (const [key, value] of new FormData(event.target)) input[key] = ['integer', 'number'].includes(selected.input_schema.properties[key].type) ? Number(value) : value;
  setBusy(true); $('#run-status').dataset.state = 'running';
  $('#run-status').textContent = 'Consultando la API y verificando la respuesta…';
  $('#result').textContent = 'Ejecución en curso…'; $('#evidence').textContent = 'Esperando la comprobación del backend.';
  const start = performance.now();
  try {
    const result = await api(`/v1/workflows/${selected.id}`, input);
    $('#result').textContent = JSON.stringify(result.data, null, 2); $('#evidence').textContent = JSON.stringify(result.evidence, null, 2);
    $('#run-status').textContent = 'Completado · las comprobaciones del workflow pasaron.'; $('#run-status').dataset.state = 'success';
  } catch (error) {
    $('#result').textContent = 'No se devuelve un resultado como válido.'; $('#run-status').textContent = errorText(error); $('#run-status').dataset.state = 'error';
  } finally { $('#duration').textContent = `${Math.round(performance.now() - start)} ms`; setBusy(false); }
});
function review(raw) {
  if (!raw || !Array.isArray(raw.approved_requests) || !Array.isArray(raw.training) || !Array.isArray(raw.evaluation)) throw new Error('INVALID_CAPTURE');
  capture = raw; $('#reviewed').checked = false; $('#learn-button').disabled = true;
  $('#capture-review').textContent = JSON.stringify({ workflow: raw.id, effect: raw.effect, operaciones: raw.approved_requests.map(operation => `${operation.method} ${operation.origin}${operation.path}`), demostraciones: raw.training.length, casos_reservados: raw.evaluation.length }, null, 2);
  $('#learn-status').textContent = 'Revisa los destinos y el efecto antes de validar.'; $('#learn-status').dataset.state = 'ready';
}
$('#capture-file').addEventListener('change', async event => {
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 1000000) throw new Error('BODY_TOO_LARGE'); review(JSON.parse(await file.text())); }
  catch (error) { capture = null; $('#learn-button').disabled = true; $('#learn-status').textContent = errorText(error); $('#learn-status').dataset.state = 'error'; }
});
$('#load-example').onclick = async () => { try { review(await api('/examples/learn-laptop.json')); } catch (error) { $('#learn-status').textContent = errorText(error); } };
$('#reviewed').onchange = event => { $('#learn-button').disabled = busy || !capture || !event.target.checked; };
$('#learn-button').onclick = async () => {
  if (busy || !capture || !$('#reviewed').checked) return;
  setBusy(true); $('#learn-status').textContent = 'Aprendiendo la receta y comprobando los casos por HTTP…';
  try {
    const result = await api('/v1/learn', { reviewed: true, capture });
    await refresh(result.workflow); $('#learn-status').textContent = `Workflow incorporado. ${result.verification.held_out_inputs.length} caso reservado comprobado. Ya puedes ejecutarlo.`;
    $('#learn-status').dataset.state = 'success';
  } catch (error) { $('#learn-status').textContent = errorText(error); $('#learn-status').dataset.state = 'error'; }
  finally { setBusy(false); }
};
refresh().catch(error => { $('#catalog-status').textContent = errorText(error); });

for (const id of ['#discover-url', '#discover-category', '#discover-id']) $(id).addEventListener('input', () => { pendingDiscoveryOperations = []; $('#discover-reviewed').checked = false; $('#discover-review-label').hidden = true; });
$('#discover-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (pendingDiscoveryOperations.length && !$('#discover-reviewed').checked) { $('#discovery-progress').textContent = 'Confirma primero la revisión de las operaciones bloqueadas.'; return; }
  const request = { url: $('#discover-url').value, task: $('#discover-task').value, id: $('#discover-id').value,
    ...($('#discover-category').value.trim() ? { category: $('#discover-category').value.trim() } : {}),
    ...(pendingDiscoveryOperations.length ? { reviewed_requests: pendingDiscoveryOperations, reviewed: true } : {}) };
  setBusy(true); $('#discovery-progress').textContent = 'Iniciando el navegador aislado…';
  try {
    const started = await api('/v1/discoveries', request);
    let job;
    do {
      await new Promise(resolve => setTimeout(resolve, 900));
      job = await api(`/v1/discoveries/${started.id}`);
      $('#discovery-progress').textContent = job.events.map(event => `${event.stage}: ${event.detail}`).join('\n') || job.status;
    } while (['running', 'evaluating'].includes(job.status));
    if (job.status !== 'verified') {
      if (job.blocked_operations?.length) {
        pendingDiscoveryOperations = job.blocked_operations; $('#discover-review-label').hidden = false; $('#discover-reviewed').checked = false;
        $('#discovery-progress').textContent += `\n\nOperaciones bloqueadas, pendientes de revisión:\n${JSON.stringify(pendingDiscoveryOperations, null, 2)}`;
      }
      throw new Error(job.error);
    }
    await refresh(job.workflow);
    $('#discovery-progress').textContent += `\n\nVERIFICADO: ${job.workflow}\n${JSON.stringify(job.cases, null, 2)}`;
  } catch (error) { $('#discovery-progress').textContent += `\n${errorText(error)}`; }
  finally { setBusy(false); }
});
