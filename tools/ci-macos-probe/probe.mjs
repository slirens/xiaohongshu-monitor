const invoke = globalThis.__TAURI__.core.invoke;
const byId = id => document.getElementById(id);
const waitFor = async predicate => {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Prototype state did not advance.');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
};

try {
  await import('./app.mjs');
  const panel = byId('task').getBoundingClientRect();
  const stages = byId('stages');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (panel.width < 580 || panel.width > 665 || stages.children.length !== 3 || accent !== '#4f46b8') {
    throw new Error(`Shared style or layout unavailable: panel=${panel.width}, accent=${accent}`);
  }
  byId('continue').click();
  if (byId('continue').getAttribute('aria-pressed') !== 'true' || byId('keyword').value !== '宝山 硚口') {
    throw new Error('The shared continuation view did not restore its fixture.');
  }
  byId('start-task').click();
  if (byId('execution').hidden || byId('execution').dataset.state !== 'startup') {
    throw new Error('The shared execution panel did not open.');
  }
  await waitFor(() => byId('execution').dataset.state === 'login');
  byId('run-primary').click();
  if (byId('execution').dataset.state !== 'working') throw new Error('The login continuation did not resume.');
  await waitFor(() => stages.children[2].getAttribute('aria-current') === 'step');
  if (byId('setup').hidden || !byId('execution').hidden) throw new Error('The shared result did not return to setup.');
  await invoke('webview_ready', { proof: JSON.stringify({
    fixture: 'shared-f', viewport: [innerWidth, innerHeight], devicePixelRatio,
    panelWidth: panel.width, accent, states: ['setup', 'continue', 'startup', 'login', 'working', 'result'],
  }) });
} catch (error) {
  await invoke('webview_failed', { reason: error instanceof Error ? error.message : String(error) });
  throw error;
}
