import { runChecks } from './checks.js';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('check.html') });
});

// The check page asks the service worker to run the same checks, because the
// real sync will run here on a timer, not in a page.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'run-checks') return false;
  runChecks().then(sendResponse, (error) => sendResponse({ error: String(error) }));
  return true;
});
