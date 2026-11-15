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
}

export interface AgentMessage {
  id: string;
  role: 'agent';
  plan?: { steps: PlanStep[]; open: boolean; done: boolean };
  approval?: { action: string; state: 'pending' | 'approved' | 'rejected' };
  answer?: string;
  streaming?: boolean;
  stopped?: boolean;
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
  type: 'click' | 'input' | 'select' | 'submit' | 'navigate';
  selector: string;
  label: string;
  value?: string;
  url: string;
  t: number;
}

export interface SavedFlow {
  id: string;
  title: string;
  host: string;
  createdAt: number;
  actions: RecordedAction[];
}
