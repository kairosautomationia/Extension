import type { Message } from '../types';

/** Conversación guardada en este navegador (localStorage de la extensión). */
export interface StoredChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

const KEY = 'hanzo.chats';
const MAX_CHATS = 50;
/** Tope por respuesta guardada: una tabla extraída enorme no debe llenar el almacenamiento y borrar chats antiguos. */
const MAX_SAVED_ANSWER = 40_000;

function trimAnswer(a: string | undefined): string | undefined {
  if (!a || a.length <= MAX_SAVED_ANSWER) return a;
  const cut = a.lastIndexOf('\n', MAX_SAVED_ANSWER);
  return `${a.slice(0, cut > 0 ? cut : MAX_SAVED_ANSWER)}\n\n_(Respuesta recortada en el historial por su tamaño. Para descargarla completa, vuelve a pedirla o a extraer las tablas.)_`;
}

export function loadChats(): StoredChat[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as StoredChat[];
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

function write(list: StoredChat[]): boolean {
  // Si el almacenamiento se llena, se descartan las conversaciones más antiguas y se reintenta.
  let l = list;
  for (let i = 0; i < 20; i++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
      return true;
    } catch {
      if (l.length <= 1) return false;
      l = l.slice(0, -1);
    }
  }
  return false;
}

/** Quita lo que no debe guardarse: imágenes pesadas, aprobaciones pendientes y estados "en curso". */
function clean(messages: Message[]): Message[] {
  return messages.map((m): Message => {
    if (m.role === 'user') return { ...m, attachments: m.attachments.map((a) => ({ id: a.id, kind: a.kind, name: a.name })) };
    return {
      ...m,
      answer: trimAnswer(m.answer),
      streaming: false,
      approval: undefined,
      plan: m.plan && {
        ...m.plan,
        done: true,
        steps: m.plan.steps.map((s) => (s.state === 'running' || s.state === 'pending' ? { ...s, state: 'skipped' as const } : s)),
      },
    };
  });
}

function titleOf(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  const t = first && first.role === 'user' ? first.text.replace(/\s+/g, ' ').trim() : '';
  return (t || 'Conversación').slice(0, 48);
}

export function saveChat(id: string, messages: Message[]): void {
  if (messages.length === 0) return;
  const rest = loadChats().filter((c) => c.id !== id);
  const chat: StoredChat = { id, title: titleOf(messages), updatedAt: Date.now(), messages: clean(messages) };
  write([chat, ...rest].slice(0, MAX_CHATS));
}

export function deleteChat(id: string): void {
  write(loadChats().filter((c) => c.id !== id));
}

export function clearChats(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export function whenLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86400000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return d.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
}
