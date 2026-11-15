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
