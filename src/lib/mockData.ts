import type { Conversation, TabInfo } from '../types';

export const MOCK_TAB: TabInfo = {
  title: 'Carrito de compras - Amazon.com',
  url: 'https://www.amazon.com/gp/cart/view.html',
  host: 'amazon.com',
};

export const SUGGESTIONS = [
  'Resumir esta página',
  'Extraer datos de la tabla',
  'Rellenar formulario',
];

export const SHORTCUTS = [
  { id: 's1', title: 'Resumir y extraer puntos clave', prompt: 'Resume esta página en 5 puntos clave' },
  { id: 's2', title: 'Comparar precios del carrito', prompt: 'Compara los precios de los productos del carrito' },
  { id: 's3', title: 'Completar checkout', prompt: 'Completa el checkout con mis datos guardados' },
];

export const HISTORY: Conversation[] = [
  { id: 'h1', title: 'Extraer tabla de precios', when: 'Hoy' },
  { id: 'h2', title: 'Rellenar formulario de contacto', when: 'Hoy' },
  { id: 'h3', title: 'Resumen del informe trimestral', when: 'Ayer' },
  { id: 'h4', title: 'Reservar vuelo a Lisboa', when: 'Hace 3 días' },
];

export const MODELS = [
  { id: 'pro', label: 'Modelo Pro', hint: 'Máxima calidad' },
  { id: 'balanced', label: 'Modelo Equilibrado', hint: 'Calidad y velocidad' },
  { id: 'light', label: 'Modelo Ligero', hint: 'Respuestas inmediatas' },
];

export const FINAL_ANSWER =
  'He completado la tarea en la pestaña actual.\n\n' +
  'Revisé el carrito, localicé el botón de pago y, con tu aprobación, confirmé el pedido. ' +
  'El resumen quedó así:\n\n' +
  '- **3 artículos** en el carrito, con un total de **$142,90**.\n' +
  '- Envío estándar seleccionado, entrega estimada en **2 a 3 días**.\n' +
  '- No modifiqué ningún dato de tu cuenta.\n\n' +
  'Si quieres, puedo guardar este flujo como un atajo para repetirlo la próxima vez.';

export const READONLY_ANSWER =
  'Estoy en modo **solo lectura**, así que no interactúo con la página; solo la analizo.\n\n' +
  'Esto es lo que veo:\n\n' +
  '- Una página de carrito con **3 artículos** y un total de **$142,90**.\n' +
  '- Un botón principal de pago, que no pulsaré en este modo.\n\n' +
  'Cambia a *Manual* o *Auto* si quieres que actúe sobre la página.';
