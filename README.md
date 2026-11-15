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

- La lógica del agente es una simulación en `src/hooks/useAgent.ts`. Reemplaza el bucle de `send` por tu llamada real al modelo.
- Permisos del manifest: `sidePanel`, `tabs`, `activeTab` y `<all_urls>` (necesario para la captura de pantalla).

## Despliegue en Cloudflare (Workers con assets estáticos)

El sitio (vista del panel) se sirve desde `dist/` según `wrangler.jsonc`.

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- El nombre del Worker en Cloudflare debe ser `extension` (o cambia `name` en `wrangler.jsonc`).
- Manual: `npm run deploy` (requiere `wrangler login`).
