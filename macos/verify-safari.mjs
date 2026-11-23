import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { collectSafari, openSafari } from '../safari.mjs';
import { parseDisplayedDate, presetsCovering } from '../monitor.mjs';

const keyword = '宝山';
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format();
const current = '0123456789abcdef01234567';
const previous = '0123456789abcdef01234568';
const opened = [];
let signedIn = false;
let asks = 0;
const server = createServer((request, response) => {
  const address = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (address.pathname === '/search_result') {
    assert.equal(address.searchParams.get('keyword'), keyword);
    response.end(signedIn ? `<!doctype html>
      <button onclick="filters.hidden = false">筛选</button>
      <div id="filters" hidden>
        <h3>排序依据</h3><button onclick="document.body.dataset.order = 'latest'">最新</button>
        <h3>发布时间</h3><button onclick="if (document.body.dataset.order === 'latest') { results.hidden = false; filters.hidden = true; }">一天内</button>
      </div>
      <div id="results" hidden>
        <section class="note-item"><a href="/search_result/${current}?mark=entry">当天笔记</a><time>${date}</time></section>
        <section class="note-item"><a href="/search_result/${previous}">较早笔记</a><time>3天前</time></section>
      </div>` : '<!doctype html><main>扫码登录</main>');
  } else if (address.pathname.startsWith('/search_result/')) {
    const id = address.pathname.split('/').pop();
    opened.push(id);
    response.writeHead(302, { Location: `/explore/${id}?mark=final` }).end();
  } else {
    response.end(`<!doctype html><section class="note-content"><h1 id="detail-title">当天笔记</h1>
      <p id="detail-desc">Safari 自动化测试</p><time class="date">${date}</time></section>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const result = await collectSafari(keyword, { start: date, end: date, sort: '最新', screens: 1 }, async message => {
    assert.match(message, /完成小红书登录/);
    signedIn = true;
    asks++;
    return '继续';
  }, { parseDisplayedDate, presetsCovering }, {
    origin,
    open: async (...args) => {
      const window = await openSafari(...args);
      await window.mode('background');
      await window.mode('foreground');
      return window;
    },
  });
  assert.equal(asks, 1);
  assert.equal(result.pageFilter, '一天内');
  assert.equal(result.candidates, 2);
  assert.deepEqual(opened, [current]);
  assert.deepEqual(result.notes.map(note => [note.title, note.date, note.url]),
    [['当天笔记', date, `${origin}/explore/${current}?mark=final`]]);
  console.log('Safari passed login prompt, background/foreground, date filter and final note link checks.');
} finally {
  await new Promise(resolve => server.close(resolve));
}
