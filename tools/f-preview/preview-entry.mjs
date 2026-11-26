const invoke = globalThis.__TAURI__.core.invoke;

if (await invoke('verify_preview')) {
  await import('./probe.mjs');
} else {
  await import('./app.mjs');
  await invoke('preview_ready');
}
