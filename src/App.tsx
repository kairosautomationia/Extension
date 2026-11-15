import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionMode } from './types';
import { useActiveTab } from './hooks/useActiveTab';
import { useAgent } from './hooks/useAgent';
import { useFlowRecorder } from './hooks/useFlowRecorder';
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
  const tab = useActiveTab();
  const [captureN, setCaptureN] = useState(0);
  const onCapture = useCallback(() => setCaptureN((n) => n + 1), []);
  const agent = useAgent(mode, { onCapture });
  const rec = useFlowRecorder(tab);

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
        onRunShortcut={(p) => agent.send(p)}
        onReplay={agent.replay}
        busy={agent.running}
        flows={rec.flows}
        savedKey={rec.savedKey}
        onDeleteFlow={rec.removeFlow}
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
