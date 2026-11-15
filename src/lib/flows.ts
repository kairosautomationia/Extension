import type { RecordedAction, SavedFlow } from '../types';

export function describeAction(a: RecordedAction): string {
  switch (a.type) {
    case 'click':
      return `Clic en "${a.label}"`;
    case 'input':
      return `Escribir "${a.value ?? ''}" en "${a.label}"`;
    case 'select':
      return `Elegir "${a.value ?? ''}" en "${a.label}"`;
    case 'submit':
      return 'Enviar formulario';
    case 'key':
      return `Pulsar ${a.value ?? 'Enter'}${a.label ? ` en "${a.label}"` : ''}`;
    case 'scroll':
      return 'Desplazar la página';
    case 'capture':
      return 'Captura de pantalla';
    case 'navigate':
      try {
        const u = new URL(a.url);
        return `Ir a ${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
      } catch {
        return `Ir a ${a.url}`;
      }
  }
}

export function flowToPrompt(f: SavedFlow): string {
  const steps = f.actions.map((a, i) => `${i + 1}. ${describeAction(a)}`).join('\n');
  return `Repite este flujo en ${f.host}:\n${steps}`;
}

const KEY = 'hanzo.flows';

export function loadFlows(): SavedFlow[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedFlow[];
  } catch {
    return [];
  }
}

export function persistFlows(flows: SavedFlow[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(flows));
  } catch {
    /* almacenamiento no disponible */
  }
}
