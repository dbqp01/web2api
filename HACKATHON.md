# Web2API · Guía de presentación

Web2API convierte recorridos web observados en herramientas reutilizables que ejecutan HTTP y verifican sus respuestas. El estudio permite probar el contrato, ver la evidencia y consumirlo desde REST o MCP.

## Preparación

Requiere Node 24.x. Desde el repositorio, con las dependencias ya instaladas:

```bash
npm run studio:demo
```

Abre http://127.0.0.1:4320. No requiere Internet, servicios externos ni cuentas personales. Las fuentes se sirven localmente. El laboratorio usa tres productos ficticios y permite probar escrituras sin compras ni pagos.

Para el catálogo de webs externas:

```bash
npm start
```

Abre http://127.0.0.1:4319. Comprueba tu conectividad y prueba Demoblaze antes de presentar. Las sesiones autenticadas pueden expirar; no son necesarias para demostrar la propuesta.

## Recorrido de tres minutos

1. **El problema.** Una interacción web repetida obliga a navegar y hacer clic de nuevo. Web2API conserva el recorrido como contrato tipado y lo ejecuta por HTTP.
2. **La llamada.** En la demo local, selecciona Buscar productos. Deja la búsqueda vacía: aparecen Té verde (S/ 12.00), Café peruano (S/ 25.00) y Taza de cerámica (S/ 18.00).
3. **La prueba.** Abre Evidencia: muestra la fuente local, hora y verificación. Abre JSON para ver centavos enteros, total y truncación explícita.
4. **El cambio verificado.** Selecciona Añadir al carrito, SKU `coffee`, cantidad `2`, y marca la confirmación. El subtotal será S/ 50.00 si el carrito está vacío. Consulta el carrito para demostrar persistencia en la sesión.
5. **La integración.** Abre Solicitud y muestra la llamada cURL. Abre OpenAPI para los parámetros y contratos. Las aplicaciones externas deben configurar su propia clave de acceso local.
6. **La trazabilidad.** Abre Historial y vuelve a una ejecución sin repetirla. Descarga su resultado y evidencia.

Una búsqueda sin coincidencias termina correctamente con cero resultados. Un SKU inexistente debe fallar. No repitas una escritura a ciegas después de un error: consulta primero el carrito.

## Descubrimiento y aprendizaje

Con Internet y Chromium instalado, Descubrir admite el patrón catálogo público → ficha en una URL HTTPS compatible. Un caso reservado verifica que el contrato funcione con una entrada distinta de las demostraciones. Un fallo o una operación no revisada impide su incorporación.

La vista Importar evidencia permite cargar una captura JSON revisada; el ejemplo de portátiles consulta Demoblaze. Confirma las operaciones antes de validar. El backend guarda el workflow solo si la evaluación pasa. El catálogo y OpenAPI se actualizan inmediatamente.

El laboratorio local observa sus rutas de demostración al arrancar; no se presenta como descubrimiento autónomo de una web desconocida. Los productos, precios y carrito son ficticios, pero las solicitudes HTTP y la comprobación del estado ocurren realmente.

## Llevar el paquete

```bash
npm run build
```

Copia `artifacts/web2api-app` al equipo de presentación. Con Node 24 instalado, ejecuta desde esa carpeta:

```bash
npm run studio:demo
```

La demo HTTP local funciona sin npm install. Para descubrir URLs desde un equipo nuevo, instala el navegador con la instrucción de `BROWSER_SETUP.txt`.

## Límites que conviene explicar

- La ejecución de workflows no usa navegador, visión ni llamadas a un modelo. El descubrimiento sí usa un navegador aislado.
- Solo hay soporte automático para el patrón de descubrimiento documentado, no para cualquier web u objetivo.
- USGAR, Demoblaze y Automation Exercise son fuentes externas; pueden cambiar, limitar consultas o estar temporalmente fuera de servicio.
- UVCV necesita una sesión autorizada y validada. Las notas no son un récord académico oficial.
- WhatsApp funciona en un MCP separado con Baileys, un cliente no oficial que puede infringir los términos del servicio. No está en el paquete independiente.
- Las escrituras del estudio están limitadas al laboratorio ficticio. No se realizan reservas, pagos ni envíos de mensajes.
- El servidor escucha en loopback y está pensado para uso local. No es un despliegue público multiusuario.
- El historial de respuestas vive solo en esta pestaña. Los workflows aprendidos se guardan en el directorio local de Web2API; los resultados descargados quedan donde el navegador los guarde.

## Diseño

Dirección Framed sheet, semilla 1966259552, sin redibujos. Marco azul grisáceo, hoja blanca, marca de corchetes y flecha que representa el paso web → contrato, tipografía IBM Plex Sans y Mono local con licencia OFL. Las vistas responden a trabajos concretos: ejecutar, descubrir, importar, revisar ejecuciones, configurar conexiones y presentar.

La UI no usa fotografías, testimonios, cifras de rendimiento ni estadísticas inventadas. La secuencia Web observada → Contrato HTTP → Respuesta verificada expresa el proceso real del producto. Las muestras están limitadas al laboratorio identificado y al ejemplo de importación de portátiles.
