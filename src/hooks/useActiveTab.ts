import { useEffect, useState } from 'react';
import type { TabInfo } from '../types';
import { MOCK_TAB } from '../lib/mockData';

function toInfo(t: chrome.tabs.Tab): TabInfo {
  let host = '';
  try {
    host = new URL(t.url ?? '').hostname.replace(/^www\./, '');
  } catch {
    host = t.url ?? '';
  }
  return { title: t.title ?? host, url: t.url ?? '', host, favIconUrl: t.favIconUrl };
}

/** Pestaña activa real (en la extensión) o una simulada (en `vite dev`). */
export function useActiveTab(): TabInfo {
  const [tab, setTab] = useState<TabInfo>(MOCK_TAB);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;

    const refresh = () =>
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([t]) => t && setTab(toInfo(t)))
        .catch(() => {});

    refresh();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.status === 'complete' || info.title) refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tab;
}
