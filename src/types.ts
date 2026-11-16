export type PermissionMode = 'manual' | 'auto' | 'readonly';

export interface Attachment {
  id: string;
  kind: 'screenshot' | 'image' | 'file';
  name: string;
  url?: string; // data URL para previsualizar
}

export interface PlanStep {
  id: string;
  code: string; // acción técnica, p.ej. click("#submit-btn")
  label: string;
  state: 'pending' | 'running' | 'done' | 'skipped';
}

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  attachments: Attachment[];
  /** Mensaje solo de la interfaz: no se envía al modelo. */
  local?: boolean;
}

export interface AgentMessage {
  id: string;
  role: 'agent';
  plan?: { steps: PlanStep[]; open: boolean; done: boolean };
  approval?: { action: string; state: 'pending' | 'approved' | 'rejected' };
  answer?: string;
  streaming?: boolean;
  stopped?: boolean;
  /** Repetición de una acción grabada (no ofrece "Guardar como atajo"). */
  replay?: boolean;
  /** Respuesta hecha en la extensión (p.ej. tablas extraídas): no se envía al modelo. */
  local?: boolean;
}

export type Message = UserMessage | AgentMessage;

export interface TabInfo {
  title: string;
  url: string;
  host: string;
  favIconUrl?: string;
}

export interface Conversation {
  id: string;
  title: string;
  when: string;
}

export interface RecordedAction {
  id: string;
  type: 'click' | 'input' | 'select' | 'submit' | 'navigate' | 'key' | 'scroll' | 'capture';
  selector: string;
  label: string;
  /** Texto escrito, opción elegida, tecla (key) o posición de desplazamiento (scroll). */
  value?: string;
  url: string;
  t: number;
}

export interface SavedFlow {
  id: string;
  title: string;
  host: string;
  createdAt: number;
  /** Página donde empezó la grabación. */
  startUrl?: string;
  /** Para qué sirve el flujo (lo escribe el usuario). */
  description?: string;
  /** Etiquetas para encontrarlo rápido. */
  tags?: string[];
  /** Cuántas veces se repitió completo y cómo terminó la última vez. */
  runs?: number;
  lastRunAt?: number;
  lastResult?: 'ok' | 'fail';
  lastNote?: string;
  actions: RecordedAction[];
}
