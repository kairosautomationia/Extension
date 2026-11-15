# Hanzo

Agente de IA en el panel lateral de Chrome (Manifest V3). React + TypeScript + Tailwind + Framer Motion.

## Desarrollo

```bash
npm install
npm run dev        # vista previa en http://localhost:5173/sidepanel.html
```

## Compilar y cargar en Chrome

```bash
npm run build      # genera dist/
```

1. Abre `chrome://extensions` y activa el modo desarrollador.
2. Pulsa "Cargar descomprimida" y elige la carpeta `dist/`.
3. Pulsa el icono de Hanzo para abrir el panel lateral.

## Publicación

Comprime el contenido de `dist/` en un `.zip` y súbelo al Chrome Web Store Developer Dashboard.

## Notas

- El agente usa un único modelo, `@cf/google/gemma-4-26b-a4b-it` (Workers AI, plan gratuito: 10 000 neuronas/día), vía el Worker `worker/index.ts` (`POST /api/agent`, streaming). Por ahora solo lee y analiza la pestaña activa; las acciones sobre la página están pendientes.
- La URL del Worker (`https://extension.kairosautomation-ia.workers.dev`) está fija en `src/lib/api.ts`; puedes sobreescribirla con `VITE_API_URL` al compilar.
- Permisos del manifest: `sidePanel`, `tabs`, `activeTab` y `<all_urls>` (necesario para la captura de pantalla).

## Despliegue en Cloudflare (Workers con assets estáticos)

El sitio (vista del panel) se sirve desde `dist/` según `wrangler.jsonc`.

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- El nombre del Worker en Cloudflare debe ser `extension` (o cambia `name` en `wrangler.jsonc`).
- Manual: `npm run deploy` (requiere `wrangler login`).

## Web (Geekflare)

Si el Worker tiene el secreto `GEEKFLARE_KEY`, Hanzo puede **leer una URL** (si el mensaje contiene un enlace) y **buscar en internet** (mensajes que empiezan con "busca…" / "investiga…" o mencionan "en internet/la web"). Sin el secreto, esas funciones se desactivan y el chat sigue igual.

```bash
npx wrangler secret put GEEKFLARE_KEY
```

La clave nunca va en el código ni en la extensión.

## Acciones en la página (`/hacer`)

Escribe `/hacer <tarea>` en el chat (por ejemplo: `/hacer escribe "zapatos" en el buscador`). Hanzo numera los elementos visibles de la pestaña activa, el modelo propone **una acción por turno** (clic, escribir, desplazar) y la extensión la ejecuta.

Límites de seguridad:

- **Solo lectura**: no actúa. **Manual**: pide aprobación antes de cada acción. **Automático**: solo aprueba solo lo de bajo riesgo; botones de pagar/enviar/eliminar/confirmar y envíos de formularios siempre piden aprobación.
- Nunca escribe en campos de contraseña, tarjeta, CVV, cuentas, cédula/pasaporte ni archivos (se re-comprueba dentro de la página).
- No actúa en sitios de banca y pagos (lista fija en `src/lib/actions.ts`).
- Solo la pestaña activa; si cambia de sitio, se detiene. Máximo 12 pasos por tarea y botón Detener.
- El texto de la página se trata como dato, nunca como instrucciones. El Worker valida cada acción del modelo (ids, tipos, longitudes).
- La acción se resalta con un recuadro naranja en la página antes de ejecutarse.

### Comando como habilidad
Al escribir `/` en el chat aparece la habilidad **/hacer** (Enter o Tab la inserta) y queda resaltada en azul en el cuadro de texto y en el mensaje enviado.

## Grabar y repetir acciones
1. Pulsa **Grabar** en la barra del chat y usa la página: se anotan clics, escritura, listas, casillas, Enter, desplazamientos y capturas de pantalla.
2. Al **Detener**, el flujo queda guardado en la etiqueta de la esquina superior derecha.
3. Allí, el botón ▶ repite todo el flujo en la página; tocar una acción repite solo esa.

Seguridad al repetir: los datos de contraseña, tarjeta o identidad nunca se guardan ni se rellenan (te pide que los completes tú); enviar, pagar, borrar o confirmar siempre pide aprobación; no actúa en banca y pagos; se detiene si la página cambia de sitio o no encuentra el elemento; solo cambia de sitio con tu aprobación. Un botón **Detener** corta la repetición en cualquier momento.

## Agente de voz (ElevenLabs)

El botón de ondas, entre **Vínculos** y enviar, abre una conversación de voz con el agente *Hanzo* de ElevenLabs
(ID del agente en `src/hooks/useVoiceAgent.ts`; el ID es público, la clave secreta nunca va en la extensión).

- Conexión por WebRTC con el SDK `@elevenlabs/client`.
- Herramienta de cliente **`pedir_a_hanzo`** (parámetro de texto `instruccion`): lo que el usuario pide por voz entra al
  mismo chat de Hanzo, con las mismas aprobaciones y límites de seguridad que si lo hubiera escrito.
- Al conectar solo se le dice al agente en qué sitio está el usuario (nunca el título de la página, que es texto de terceros).
- Si Chrome no deja pedir el micrófono desde el panel lateral, se abre `mic.html` una vez para concederlo.
- En ElevenLabs hay que tener creada esa herramienta con ese nombre exacto y pegado el mensaje del sistema de Hanzo.

## Otras piezas del panel

- **Vínculos**: accesos rápidos (GitHub, Cloudflare, Gmail, Drive, Calendar, Make, WhatsApp) con logos de marca (`src/lib/brands.ts`).
- **Preguntar a Hanzo**: burbuja al seleccionar texto en una página (`public/content.js`); no aparece en bancos/pagos ni en contraseñas.
- **Clic derecho → Hanzo**: abre el panel lateral.
- Requiere Chrome 116 o superior.
