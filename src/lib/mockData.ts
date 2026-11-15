import type { Conversation, TabInfo } from '../types';

export const MOCK_TAB: TabInfo = {
  title: 'Pestaña actual',
  url: 'https://',
  host: 'pestaña actual',
};

export const SUGGESTIONS = [
  'Resumir esta página',
  'Extraer datos de la tabla',
  'Analizar este negocio',
];

export const SHORTCUTS = [
  { id: 's1', title: 'Resumir y extraer puntos clave', prompt: 'Resume esta página en 5 puntos clave' },
  { id: 's2', title: 'Ver qué pide este formulario', prompt: 'Lista los campos de este formulario y cuáles son obligatorios' },
  { id: 's3', title: 'Redactar respuesta a lo que veo', prompt: 'Redacta una respuesta corta y directa al mensaje o correo que veo en esta página' },
];

export const HISTORY: Conversation[] = [];

export const MODELS = [
  { id: 'pro', label: 'Modelo Pro', hint: 'Máxima calidad' },
  { id: 'balanced', label: 'Modelo Equilibrado', hint: 'Calidad y velocidad' },
  { id: 'light', label: 'Modelo Ligero', hint: 'Respuestas inmediatas' },
];
