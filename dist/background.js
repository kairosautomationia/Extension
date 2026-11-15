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
