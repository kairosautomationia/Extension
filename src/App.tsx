import { useState } from 'react';
import type { PermissionMode } from './types';
import { useActiveTab } from './hooks/useActiveTab';
import { useAgent } from './hooks/useAgent';
import { useFlowRecorder } from './hooks/useFlowRecorder';
import Header from './components/Header';
import HistoryDrawer from './components/HistoryDrawer';
import ChatStream from './components/ChatStream';
import PromptBox from './components/PromptBox';

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
  const agent = useAgent(mode);
  const rec = useFlowRecorder(tab);

  return (
    <div className="relative mx-auto flex h-dvh w-full min-w-[320px] max-w-[450px] flex-col overflow-hidden bg-paper">
      <Header
        mode={mode}
        onModeChange={setMode}
        onOpenHistory={() => setHistoryOpen(true)}
        onNewChat={agent.reset}
        onRunShortcut={(p) => agent.send(p)}
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
      />

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
