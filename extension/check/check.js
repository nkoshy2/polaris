import { runChecks } from './checks.js';

const runButton = document.getElementById('run');
const copyButton = document.getElementById('copy');
const status = document.getElementById('status');
const results = document.getElementById('results');

let lastReport = null;

function section(title, report) {
  const wrap = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  wrap.append(heading);
  if (report.error) {
    const p = document.createElement('p');
    p.className = 'verdict bad';
    p.textContent = report.error;
    wrap.append(p);
    return wrap;
  }
  for (const source of [report.canvas, report.gradescope]) {
    const p = document.createElement('p');
    p.className = `verdict ${source.verdict.startsWith('Works') ? 'ok' : 'bad'}`;
    p.textContent = `${source.source}: ${source.verdict}`;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(source, null, 2);
    wrap.append(p, pre);
  }
  return wrap;
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  results.replaceChildren();
  status.textContent = 'Running…';
  const [page, worker] = await Promise.all([
    runChecks().catch((error) => ({ error: String(error) })),
    chrome.runtime.sendMessage({ type: 'run-checks' }).catch((error) => ({ error: String(error) })),
  ]);
  lastReport = { page, worker };
  results.append(section('From the extension page', page), section('From the service worker (where sync will run)', worker));
  status.textContent = 'Done.';
  runButton.disabled = false;
  copyButton.disabled = false;
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
  status.textContent = 'Results copied. They include course and assignment names, so review before sharing.';
});
