/**
 * Runs on the Polaris page and relays between it and the service worker.
 * Protocol: src/state/connector.ts in the Polaris repository.
 */
(() => {
  const toPage = (message) => window.postMessage({ from: 'polaris-connector', ...message }, location.origin);

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.from !== 'polaris-app') return;
    if (msg.type === 'ready') {
      chrome.runtime.sendMessage({ type: 'page-ready' }).then((reply) => {
        if (!reply) return;
        toPage({ type: 'hello', version: reply.version });
        for (const status of reply.statuses) toPage({ type: 'status', ...status });
        for (const batch of reply.batches) toPage({ type: 'batch', batch });
      });
    } else if (msg.type === 'sync-now') {
      chrome.runtime.sendMessage({ type: 'sync-now' });
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'batch') toPage({ type: 'batch', batch: message.batch });
    else if (message?.type === 'status') toPage(message);
  });
})();
