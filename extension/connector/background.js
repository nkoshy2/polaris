/**
 * Polaris Connector service worker. Every 30 minutes (and on request from the
 * Polaris page) it reads each source, keeps the latest batch and status in
 * chrome.storage.local, and delivers them to the most recently used Polaris
 * tab. When Polaris isn't open, the page asks for the cached batches when it
 * next loads. Nothing is sent anywhere except to the Polaris tab.
 */
import { fetchCanvasBatch } from './canvas.js';
import { fetchGradescopeBatch } from './gradescope.js';

const ALARM = 'sync';
const PERIOD_MINUTES = 30;
/** Opening Polaris re-syncs only if the last sync started longer ago than this. */
const PAGE_LOAD_MIN_MS = 5 * 60 * 1000;
const POLARIS_URLS = ['https://nkoshy2.github.io/polaris/*', 'http://localhost:5173/*', 'http://localhost:4173/*'];

/**
 * Each source's fetcher, run in this order. Canvas goes first so that when an
 * assignment is in both, Canvas creates the task and Gradescope links to it.
 */
const SOURCES = { canvas: fetchCanvasBatch, gradescope: fetchGradescopeBatch };
const NAMES = { canvas: 'Canvas', gradescope: 'Gradescope' };
/** Errors whose message is already written for the user. */
const EXPLAINED = ['SignedOutError', 'LayoutError'];

const version = chrome.runtime.getManifest().version;
let running = null;

async function readCache() {
  const { batches = {}, statuses = {} } = await chrome.storage.local.get(['batches', 'statuses']);
  return { batches, statuses };
}

/** Tabs where Polaris itself said it is ready (not just any page on a matching address). */
async function polarisTabs() {
  const { readyTabs = [] } = await chrome.storage.session.get('readyTabs');
  const tabs = await chrome.tabs.query({ url: POLARIS_URLS });
  return tabs.filter((t) => t.id != null && readyTabs.includes(t.id) && t.url);
}

async function rememberTab(tabId) {
  const { readyTabs = [] } = await chrome.storage.session.get('readyTabs');
  if (!readyTabs.includes(tabId)) await chrome.storage.session.set({ readyTabs: [...readyTabs, tabId] });
}

async function deliver(message) {
  // Each address (published site, localhost) has its own saved data, so each needs the batch.
  // Within one address one tab is enough: Polaris shares saved changes with its other tabs.
  const newest = new Map();
  for (const tab of await polarisTabs()) {
    const origin = new URL(tab.url).origin;
    if ((tab.lastAccessed ?? 0) >= (newest.get(origin)?.lastAccessed ?? -1)) newest.set(origin, tab);
  }
  for (const tab of newest.values()) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      // The tab closed or was reloaded; it gets the cached batch when it next loads.
    }
  }
}

async function syncSource(kind) {
  const at = new Date().toISOString();
  let status;
  try {
    const batch = await SOURCES[kind]();
    const { batches } = await readCache();
    await chrome.storage.local.set({ batches: { ...batches, [kind]: batch } });
    await deliver({ type: 'batch', batch });
    status = { kind, ok: true, at };
  } catch (error) {
    const message = EXPLAINED.includes(error?.name) ? error.message : `Couldn't read ${NAMES[kind]}: ${error?.message ?? error}`;
    status = { kind, ok: false, at, message };
  }
  const { statuses } = await readCache();
  await chrome.storage.local.set({ statuses: { ...statuses, [kind]: status } });
  // A successful batch already reports its own result in Polaris; only failures need a status message.
  if (!status.ok) await deliver({ type: 'status', ...status });
}

/** Runs one sync of every source, in order; concurrent requests share the run in progress. */
function syncAll() {
  running ??= (async () => {
    await chrome.storage.local.set({ lastSyncAt: Date.now() });
    for (const kind of Object.keys(SOURCES)) await syncSource(kind);
  })().finally(() => {
    running = null;
  });
  return running;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
  syncAll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
  syncAll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncAll();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'page-ready') {
    // The page just loaded: give it what we have, then refresh unless we just did.
    (async () => {
      if (sender.tab?.id != null) await rememberTab(sender.tab.id);
      const { batches, statuses } = await readCache();
      sendResponse({ version, batches: Object.values(batches), statuses: Object.values(statuses).filter((s) => !s.ok) });
      const { lastSyncAt = 0 } = await chrome.storage.local.get('lastSyncAt');
      if (Date.now() - lastSyncAt > PAGE_LOAD_MIN_MS) syncAll();
    })();
    return true;
  }
  if (message?.type === 'sync-now') {
    syncAll();
    return false;
  }
  return false;
});
