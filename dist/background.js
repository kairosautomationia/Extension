// Abre el side panel al pulsar el icono de la extensión.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

// Opción "Hanzo" en el menú de clic derecho (Chrome le pone el icono de la extensión).
function crearMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({ id: 'hanzo-abrir', title: 'Hanzo', contexts: ['all'] }, () => {
      void chrome.runtime.lastError; // si otro aviso ya lo creó, se ignora (evita error "duplicate id")
    });
  });
}
chrome.runtime.onInstalled.addListener(crearMenu);
chrome.runtime.onStartup.addListener(crearMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'hanzo-abrir' || !tab || tab.windowId === undefined) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

// "Preguntar a Hanzo" (burbuja al seleccionar texto): abre el panel y le deja el texto al panel.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'hanzo-ask' || !sender.tab || sender.tab.windowId === undefined) return;
  const text = String(msg.text || '').slice(0, 1000);
  if (!text) return;
  // Primero abrir el panel (necesita venir de un gesto del usuario), luego guardar el texto
  chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
  chrome.storage.session.set({ hanzoPending: { text, t: Date.now() } }).catch(() => {});
});

// Grupo de pestañas "Hanzo": al abrir el panel, la pestaña activa se mete en un grupo con ese nombre,
// igual que hacen otros asistentes. Desde el grupo (clic en su nombre) se puede desagrupar, cerrar o eliminar.
// Para quitar esta función basta con poner AGRUPAR_PESTANA en false.
const AGRUPAR_PESTANA = true;
const NOMBRE_GRUPO = 'Hanzo';
let agrupando = null;

function agruparActiva() {
  if (!AGRUPAR_PESTANA || !chrome.tabGroups) return Promise.resolve();
  if (agrupando) return agrupando; // evita crear dos grupos si llegan dos avisos a la vez
  agrupando = (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // Las pestañas fijadas no se pueden agrupar; si ya está en un grupo (el de Hanzo u otro del usuario) no se toca
    if (!tab || tab.id === undefined || tab.pinned || tab.windowId === undefined) return;
    if (tab.groupId !== undefined && tab.groupId !== -1) return;
    const existentes = await chrome.tabGroups.query({ windowId: tab.windowId, title: NOMBRE_GRUPO });
    if (existentes.length > 0) {
      await chrome.tabs.group({ tabIds: [tab.id], groupId: existentes[0].id });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
    await chrome.tabGroups.update(groupId, { title: NOMBRE_GRUPO, color: 'blue', collapsed: false });
  })()
    .catch(() => {}) // agrupar es opcional: si Chrome lo rechaza (pestaña arrastrándose, etc.) no se registra como error
    .finally(() => {
      agrupando = null;
    });
  return agrupando;
}

// El panel avisa cuando se abre (conectando un puerto); se espera un instante para leer la pestaña activa ya estable.
let panelesAbiertos = 0;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'hanzo-panel') return;
  panelesAbiertos++;
  setTimeout(agruparActiva, 250);
  // Al cerrar el panel, el grupo "Hanzo" se deshace (las pestañas se quedan abiertas)
  port.onDisconnect.addListener(() => {
    panelesAbiertos = Math.max(0, panelesAbiertos - 1);
    if (panelesAbiertos === 0) setTimeout(desagrupar, 150);
  });
});

async function desagrupar() {
  if (!AGRUPAR_PESTANA || !chrome.tabGroups || panelesAbiertos > 0) return;
  try {
    if (agrupando) await agrupando;
    const grupos = await chrome.tabGroups.query({ title: NOMBRE_GRUPO });
    for (const g of grupos) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      const ids = tabs.map((t) => t.id).filter((x) => x !== undefined);
      if (ids.length) await chrome.tabs.ungroup(ids);
    }
  } catch {
    /* si Chrome lo rechaza (p. ej. arrastrando una pestaña) se deja el grupo como está */
  }
}
