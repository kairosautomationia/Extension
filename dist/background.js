// Abre el side panel al pulsar el icono de la extensión.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error(e));

// Opción "Hanzo" en el menú de clic derecho (Chrome le pone el icono de la extensión).
function crearMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'hanzo-abrir', title: 'Hanzo', contexts: ['all'] });
  });
}
chrome.runtime.onInstalled.addListener(crearMenu);
chrome.runtime.onStartup.addListener(crearMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'hanzo-abrir' || !tab || tab.windowId === undefined) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.error(e));
});

// "Preguntar a Hanzo" (burbuja al seleccionar texto): abre el panel y le deja el texto al panel.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'hanzo-ask' || !sender.tab || sender.tab.windowId === undefined) return;
  const text = String(msg.text || '').slice(0, 1000);
  if (!text) return;
  // Primero abrir el panel (necesita venir de un gesto del usuario), luego guardar el texto
  chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch((e) => console.error(e));
  chrome.storage.session.set({ hanzoPending: { text, t: Date.now() } });
});
