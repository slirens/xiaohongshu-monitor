import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { collectSafari, openSafari } from '../safari.mjs';
import { parseDisplayedDate, presetsCovering } from '../monitor.mjs';

export async function verifySafariFixture(open, mode) {
  const keyword = '宝山';
  const rejectedKeyword = '硚口';
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format();
  const current = '0123456789abcdef01234567';
  const previous = '0123456789abcdef01234568';
  const opened = [];
  const detailsOpened = [];
  let signedIn = false;
  let asks = 0;
  const server = createServer((request, response) => {
    const address = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (address.pathname === '/favicon.ico') {
      response.writeHead(204).end();
    } else if (address.pathname === '/signed-in') {
      response.end(signedIn ? 'yes' : 'no');
    } else if (address.pathname === '/search_result') {
      const requested = address.searchParams.get('keyword');
      assert.ok([keyword, rejectedKeyword].includes(requested));
      response.end(signedIn ? `<!doctype html>
        <button onclick="filters.hidden = false">筛选</button>
        <div id="filters" hidden>
          <section><h3><span>排序</span><span>依据</span></h3>
            <button>综合</button>
            <button onclick="document.body.dataset.order = 'latest'">最新</button>
          </section>
          <section><h3>笔记类型</h3><button onclick="document.body.dataset.wrongGroup = 'true'">不限</button></section>
          <section><h3><span>发布</span><span>时间</span></h3>
            <button>不限</button>
            <button ${requested === keyword
              ? "onclick=\"if (document.body.dataset.order === 'latest' && !document.body.dataset.wrongGroup) { results.hidden = false; filters.hidden = true; }\""
              : 'disabled'}><span>一天</span><span>内</span></button>
          </section>
        </div>
        <div id="results" hidden>
          <section class="note-item"><a href="/search_result/${current}?mark=entry">当天笔记</a><time>${date}</time></section>
          <section class="note-item"><a href="/search_result/${previous}">较早笔记</a><time>3天前</time></section>
        </div>` : `<!doctype html><main><h1>登录后查看搜索结果</h1><input placeholder="输入手机号"></main>
          <script>setInterval(async () => {
            if (await (await fetch('/signed-in')).text() === 'yes') location.reload();
          }, 100);</script>`);
    } else if (address.pathname.startsWith('/search_result/')) {
      const id = address.pathname.split('/').pop();
      opened.push(id);
      response.writeHead(302, { Location: `/explore/${id}?mark=final` }).end();
    } else if (address.pathname.startsWith('/explore/')) {
      detailsOpened.push(address.pathname.split('/').pop());
      response.end(`<!doctype html><section class="note-content"><h1 id="detail-title">当天笔记</h1>
        <p id="detail-desc">Safari 自动化测试</p><time class="date">${date}</time></section>
        <div class="interact-container">
          <button class="like-wrapper"><span class="count">2</span></button>
          <button class="collect-wrapper"><span class="count">0</span></button>
          <button class="chat-wrapper"><span class="count">4</span></button>
        </div>`);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const range = { start: date, end: date, sort: '最新', screens: 1 };
  const helpers = { parseDisplayedDate, presetsCovering };
  try {
    const tracked = [{ id: previous, url: `${origin}/explore/${previous}` }];
    const result = await collectSafari(keyword, { ...range, tracked }, async message => {
      assert.match(message, /完成小红书登录|Sign in to Xiaohongshu/);
      asks++;
      if (asks === 2) {
        assert.match(message, /仍在等待登录|still waiting for sign-in/);
        signedIn = true;
      }
      return '继续';
    }, helpers, { origin, open });
    assert.equal(asks, 2);
    assert.equal(result.pageFilter, '一天内');
    assert.equal(result.candidates, 2);
    assert.deepEqual(opened, [current]);
    assert.deepEqual(detailsOpened, [current, previous]);
    assert.deepEqual(result.notes.map(note => [note.title, note.date, note.url]),
      [['当天笔记', date, `${origin}/explore/${current}?mark=final`]]);
    assert.deepEqual(result.notes[0].engagement, { likes: 2, saves: 0, comments: 4 });
    assert.deepEqual(result.refreshed, [{ ...tracked[0], engagement: { likes: 2, saves: 0, comments: 4 } }]);
    await assert.rejects(collectSafari(rejectedKeyword, range, async message => {
      assert.fail(`Unexpected prompt: ${message}`);
    }, helpers, { origin, open }), /自动筛选失败.*本关键词已跳过|could not apply the filters automatically/);
    assert.deepEqual(opened, [current]);
    console.log(`${mode} passed sign-in, automatic filter clicks, unavailable filter rejection, and final note link checks.`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.includes('--webdriver')) {
    const { openSafariWebDriver } = await import('./verify-safari-webdriver.mjs');
    await verifySafariFixture(openSafariWebDriver, 'Safari WebDriver');
  } else {
    await verifySafariFixture(async (...args) => {
      const window = await openSafari(...args);
      try {
        await window.mode('background');
        await window.mode('foreground');
        return window;
      } catch (error) {
        await window.close().catch(() => {});
        throw error;
      }
    }, 'Safari Apple Events');
  }
}
