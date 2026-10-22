// Reviewed public read operations observed in UI traffic or the site's own API docs.
// POST is not treated as read automatically. No endpoint from page text is auto-approved.
export const sitePolicies = {
  demoblaze: {
    workflow: 'lookup_demoblaze_phone', sourceMode: 'observed_first_party_http',
    description: 'Encontrar un teléfono por su nombre exacto en Demoblaze: categoría → selección de ID → ficha; contrasta identidad y precio. Tienda demo; el símbolo $ no acredita una moneda ISO ni una compra.',
    approvedRequests: [
      { origin: 'https://api.demoblaze.com', path: '/bycat', method: 'POST' },
      { origin: 'https://api.demoblaze.com', path: '/view', method: 'POST' },
    ],
  },
  automationexercise: {
    workflow: 'search_automation_products', sourceMode: 'documented_api',
    description: 'Buscar ropa en Automation Exercise: catálogo → búsqueda oficial → contraste de IDs, nombres y precios. Verifica coincidencias observadas por nombre/categoría; devuelve el texto Rs. del sitio, sin asumir moneda ISO ni disponibilidad real.',
    approvedRequests: [
      { origin: 'https://automationexercise.com', path: '/api/productsList', method: 'GET', allow_json_text: true, success: { responseCode: 200 } },
      { origin: 'https://automationexercise.com', path: '/api/searchProduct', method: 'POST', allow_json_text: true, success: { responseCode: 200 } },
    ],
  },
};
