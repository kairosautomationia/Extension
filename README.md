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
