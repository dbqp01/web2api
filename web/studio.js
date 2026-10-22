export function workflowMeta(workflow, scope) {
  if (scope === 'controlled_lab_only') return { source: 'Laboratorio local', group: 'demo', short: 'Demo' };
  if (workflow.id.startsWith('uvcv_')) return { source: 'UVCV · Moodle', group: 'session', short: 'UVCV' };
  if (workflow.id.includes('usgar')) return { source: 'usgarhoteles.com', group: 'public', short: 'USGAR' };
  if (workflow.id.includes('demoblaze')) return { source: 'demoblaze.com', group: 'public', short: 'Demoblaze' };
  if (workflow.id.includes('automation')) return { source: 'automationexercise.com', group: 'public', short: 'Automation Exercise' };
  return { source: 'Workflow aprendido', group: workflow.auth ? 'session' : 'learned', short: 'Aprendido' };
}
export function displayName(id) {
  return { search_usgar_rooms: 'Habitaciones por fecha', lookup_demoblaze_phone: 'Encontrar un teléfono', search_automation_products: 'Buscar productos', lookup_demoblaze_laptop: 'Encontrar un portátil', search_products: 'Buscar productos', get_cart: 'Consultar el carrito', add_to_cart: 'Añadir al carrito', uvcv_list_courses: 'Mis cursos', uvcv_get_course: 'Contenido de un curso', uvcv_list_assignments: 'Tareas del curso', uvcv_get_grades: 'Notas del curso', uvcv_upcoming_events: 'Próximos eventos' }[id] || id.replaceAll('_', ' ');
}
export function inputValues(properties, values, required = []) {
  const result = {};
  for (const [name, schema] of Object.entries(properties)) {
    const value = values[name];
    if (value === undefined || (value === '' && !required.includes(name))) continue;
    if (value === '' && ['number', 'integer', 'array', 'object'].includes(schema.type)) throw new Error('INVALID_INPUT');
    if (schema.type === 'boolean') result[name] = value === true || value === 'true';
    else if (['number', 'integer'].includes(schema.type)) {
      const number = Number(value);
      if (!Number.isFinite(number) || (schema.type === 'integer' && !Number.isInteger(number))) throw new Error('INVALID_INPUT');
      result[name] = number;
    } else if (['object', 'array'].includes(schema.type)) {
      try { result[name] = JSON.parse(value); } catch { throw new Error('INVALID_INPUT'); }
      if (schema.type === 'array' ? !Array.isArray(result[name]) : result[name] === null || Array.isArray(result[name]) || typeof result[name] !== 'object') throw new Error('INVALID_INPUT');
    } else result[name] = value;
  }
  return result;
}
export function defaultValue(name, schema, workflowId, now = new Date()) {
  if (schema.type === 'boolean') return false;
  if (schema.default !== undefined) return schema.default;
  if (schema.format === 'date') {
    const day = Date.parse(now.toISOString().slice(0, 10));
    return new Date(day + (name === 'check_out' ? 17 : 15) * 86400000).toISOString().slice(0, 10);
  }
  return { product_name: workflowId.includes('laptop') ? 'MacBook Pro' : 'Nexus 6', query: workflowId === 'search_products' ? 'café' : 'tshirt', guests: 2, max_results: 5, quantity: 1 }[name] ?? '';
}
export function curlRequest(origin, id, input) {
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  return `curl ${quote(`${origin}/v1/workflows/${id}`)} \\\n  -H "Authorization: Bearer \${WEB2API_API_KEY}" \\\n  -H 'Content-Type: application/json' \\\n  --data ${quote(JSON.stringify(input, null, 2))}`;
}
export function resultRows(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['products', 'rooms', 'items', 'courses', 'events', 'assignments', 'grades', 'results', 'sections']) if (Array.isArray(data[key])) return data[key];
  }
  return null;
}
export function captureSummary(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.approved_requests) || !Array.isArray(raw.training) || !Array.isArray(raw.evaluation) || raw.approved_requests.some(op => !op || !['GET','POST'].includes(op.method) || typeof op.origin !== 'string' || typeof op.path !== 'string')) throw new Error('INVALID_CAPTURE');
  return { workflow: raw.id, efecto: raw.effect, operaciones: raw.approved_requests.map(op => `${op.method} ${op.origin}${op.path}`), demostraciones: raw.training.length, casos_reservados: raw.evaluation.length };
}
