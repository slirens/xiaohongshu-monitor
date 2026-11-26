const { chromium } = require('playwright');
const { readdir, mkdir, readFile } = require('node:fs/promises');
const { resolve, join, basename } = require('node:path');

async function render() {
  const directory = resolve(__dirname, '../design/v2/icons');
  const png = join(directory, 'png');
  await mkdir(png, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 24, height: 24 }, deviceScaleFactor: 2 });
    await page.route('**/*', route => route.abort());
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.svg')) continue;
      const svg = await readFile(join(directory, file), 'utf8');
      await page.setContent('<style>body{margin:0}svg{display:block;width:24px;height:24px}</style>' + svg);
      await page.screenshot({ path: join(png, basename(file, '.svg') + '.png'), omitBackground: true });
    }
  } finally {
    await browser.close();
  }
}

render().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
