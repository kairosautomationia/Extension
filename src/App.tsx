import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionMode } from './types';
import { useActiveTab } from './hooks/useActiveTab';
import { useAgent } from './hooks/useAgent';
import { useFlowRecorder } from './hooks/useFlowRecorder';
import { useSelectionAsk } from './hooks/useSelectionAsk';
import { useVoiceAgent } from './hooks/useVoiceAgent';
import { usePanelPresence } from './hooks/usePanelPresence';
import { selectionPrompt } from './lib/selection';
import Header from './components/Header';
import HistoryDrawer from './components/HistoryDrawer';
import ChatStream from './components/ChatStream';
import PromptBox from './components/PromptBox';
import { saveChat, type StoredChat } from './lib/history';

export default function App() {
  // Modo automático por defecto; se conserva hasta que el usuario cambie de módulo.
  const [mode, setModeState] = useState<PermissionMode>(() => {
    try {
      const m = localStorage.getItem('hanzo.mode');
      return m === 'manual' || m === 'auto' || m === 'readonly' ? m : 'auto';
    } catch {
      return 'auto';
    }
  });
  const setMode = (m: PermissionMode) => {
    setModeState(m);
    try {
      localStorage.setItem('hanzo.mode', m);
    } catch {
      /* sin almacenamiento */
    }
  };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seed, setSeed] = useState({ text: '', n: 0 });
  usePanelPresence();
  const tab = useActiveTab();
  const [captureN, setCaptureN] = useState(0);
  const onCapture = useCallback(() => setCaptureN((n) => n + 1), []);
  const rec = useFlowRecorder(tab);
  const agent = useAgent(mode, { onCapture, onFlowRun: rec.markRun });

  // "Preguntar a Hanzo" desde la burbuja de la página: se envía solo; si Hanzo está ocupado, queda escrito en el cuadro
  useSelectionAsk((text) => {
    const q = selectionPrompt(text);
    if (agent.running) setSeed((s) => ({ text: q, n: s.n + 1 }));
    else agent.send(q);
  });

  // Agente de voz: lo que pide por voz entra al mismo chat (con las mismas aprobaciones)
  const voice = useVoiceAgent(
    (raw) => {
      // Lo que pide la voz con verbo de acción (abrir, buscar, escribir, pulsar…) va como tarea "/hacer";
      // el resto es conversación normal. Las aprobaciones (abrir otro sitio, enviar, pagar…) se mantienen igual.
      const accion = /^\s*(abr[eiíoa]\w*|ve\b|ir\b|vamos|entra\w*|navega\w*|busca\w*|escribe\w*|teclea\w*|pulsa\w*|haz\b|hac[eé]\b|click\w*|clic\w*|selecciona\w*|desplaza\w*|baja\b|sube\b|rellena\w*|llena\w*|cierra\w*|reproduce\w*|pon\b|pone\b)/i;
      const t = /^\s*\//.test(raw) || !accion.test(raw) ? raw : `/hacer ${raw.trim()}`;
      if (agent.running) setSeed((s) => ({ text: t, n: s.n + 1 }));
      else agent.send(t, [], t === raw ? undefined : raw.trim()); // se muestra lo dicho, sin el "/hacer" y con el plan plegado
    },
    // Solo el sitio: el título de una página es texto de terceros y no debe llegar al agente como si fuera una orden
    () => `El usuario tiene abierto el sitio ${tab.host}.`,
  );

  // Historial: cada conversación se guarda sola al terminar cada respuesta.
  const [chatId, setChatId] = useState(() => Math.random().toString(36).slice(2, 10));
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && !agent.running && agent.messages.length > 0) saveChat(chatId, agent.messages);
    prevRunning.current = agent.running;
  }, [agent.running, agent.messages, chatId]);

  const newId = () => Math.random().toString(36).slice(2, 10);
  const newChat = () => {
    agent.reset();
    setChatId(newId());
  };
  const openChat = (c: StoredChat) => {
    agent.load(c.messages);
    setChatId(c.id);
  };

  return (
    <div className="relative mx-auto flex h-dvh w-full min-w-[320px] max-w-[450px] flex-col overflow-hidden bg-paper">
      <Header
        mode={mode}
        onModeChange={setMode}
        onOpenHistory={() => setHistoryOpen(true)}
        onNewChat={newChat}
        onReplay={agent.replay}
        busy={agent.running}
        flows={rec.flows}
        savedKey={rec.savedKey}
        lastSavedId={rec.lastSavedId}
        onDeleteFlow={rec.removeFlow}
        onUpdateFlow={rec.updateFlow}
        onClearFlows={rec.clearFlows}
        onImportFlows={rec.importFlows}
      />

      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <ChatStream
          messages={agent.messages}
          tab={tab}
          onPick={(t) => setSeed((s) => ({ text: t, n: s.n + 1 }))}
          onTogglePlan={agent.togglePlan}
          onResolve={agent.resolveApproval}
        />
      </main>

      <PromptBox
        tab={tab}
        running={agent.running}
        onSend={agent.send}
        onStop={agent.stop}
        draftSeed={seed}
        recording={rec.recording}
        recSecs={rec.secs}
        recActions={rec.actions}
        recError={rec.error}
        onToggleRecord={rec.toggle}
        captureSignal={captureN}
        onCaptured={rec.addCapture}
        voice={voice.state}
        voiceError={voice.error}
        onVoiceToggle={voice.toggle}
        onExtractTables={agent.extractTables}
      />

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentId={chatId}
        onOpenChat={openChat}
        onDeleted={(id) => {
          if (id === chatId) newChat();
        }}
        onClearedAll={newChat}
      />
    </div>
  );
}
