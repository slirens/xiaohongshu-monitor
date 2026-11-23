import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function openSafariWebDriver(initialURL) {
  if (process.platform !== 'darwin') throw new Error('Safari WebDriver verification requires macOS.');
  const temporary = createServer().listen(0, '127.0.0.1');
  await once(temporary, 'listening');
  const { port } = temporary.address();
  await new Promise((resolve, reject) => temporary.close(error => error ? reject(error) : resolve()));

  const driver = spawn('/usr/bin/safaridriver', ['--port', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let failure;
  const exited = new Promise(resolve => {
    driver.on('error', error => { failure = error; });
    driver.once('close', (code, signal) => {
      failure ??= new Error(`safaridriver exited (${signal ?? code})${stderr ? ': ' + stderr.trim() : ''}`);
      resolve();
    });
  });
  driver.stderr.setEncoding('utf8').on('data', text => { stderr = (stderr + text).slice(-4000); });

  async function command(method, path, body, ms = 18000) {
    if (failure) throw failure;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(ms),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const { value } = await response.json();
    if (!response.ok || value?.error) {
      throw new Error(`Safari WebDriver ${method} ${path}: ${value?.message ?? response.status}`);
    }
    return value;
  }

  let sessionPath;
  async function close() {
    try {
      if (sessionPath) await command('DELETE', sessionPath, undefined, 3500);
    } finally {
      if (!failure && driver.pid) {
        driver.kill();
        await Promise.race([exited, delay(1500, undefined, { ref: false })]);
        if (!failure) driver.kill('SIGKILL');
      }
      await exited;
    }
  }

  try {
    const deadline = Date.now() + 10000;
    while (true) {
      if (failure) throw failure;
      const status = await command('GET', '/status', undefined, 1000).catch(() => null);
      if (status?.ready) break;
      if (Date.now() >= deadline) throw new Error('Safari WebDriver did not become ready within 10 seconds.');
      await delay(150);
    }
    const session = await command('POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'safari' } },
    }, 45000);
    if (!session?.sessionId || session.capabilities?.browserName?.toLowerCase() !== 'safari') {
      throw new Error('WebDriver did not create a Safari session.');
    }
    sessionPath = '/session/' + encodeURIComponent(session.sessionId);
    console.log('Safari WebDriver browser version:', session.capabilities.browserVersion ?? 'unknown');
    const send = (method, path, body) => command(method, sessionPath + path, body);
    await send('POST', '/timeouts', { pageLoad: 15000, script: 10000 });
    const navigate = url => send('POST', '/url', { url });
    await navigate(initialURL);
    return {
      navigate,
      url: () => send('GET', '/url'),
      evaluate: async code => JSON.parse(await send('POST', '/execute/sync', { script: `return (${code});`, args: [] })),
      mode: async () => {}, // WebDriver covers the site behavior in an isolated window.
      close,
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
