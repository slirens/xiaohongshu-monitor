import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const appleScript = promisify(execFile);
const site = 'https://www.xiaohongshu.com';
const notePattern = /^\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{24})\/?$/i;

const safariScript = `on run argv
  set actionName to item 1 of argv
  tell application "Safari"
    if actionName is "open" then
      set existingIDs to id of every window
      make new document with properties {URL:item 2 of argv}
      repeat with newID in (id of every window)
        if (contents of newID) is not in existingIDs then
          if item 3 of argv is "foreground" then activate
          return contents of newID
        end if
      end repeat
      error "Safari did not create a separate monitoring window."
    end if
    set targetID to (item 2 of argv) as integer
    if actionName is "close" then
      if exists window id targetID then close window id targetID
      return ""
    end if
    if not (exists window id targetID) then error "The monitoring Safari window was closed."
    set targetWindow to window id targetID
    if actionName is "navigate" then
      set URL of current tab of targetWindow to item 3 of argv
    else if actionName is "url" then
      return URL of current tab of targetWindow
    else if actionName is "evaluate" then
      return do JavaScript (item 3 of argv) in current tab of targetWindow
    else if actionName is "foreground" then
      set miniaturized of targetWindow to false
      set index of targetWindow to 1
      activate
    else if actionName is "background" then
      set miniaturized of targetWindow to true
    end if
    return ""
  end tell
end run`;

function safariError(error, action) {
  const details = String(error.stderr || (error.killed ? `Safari「${action}」响应超时` : error.code ?? error.message));
  if (/Apple Events|AppleScript is disabled|not allowed|not authorized|-1743|JavaScript.*disabled/i.test(details)) {
    return new Error('Safari 自动化权限未开启。请在 Safari「设置 → 高级」显示网页开发者功能，再在「开发 → 开发者设置」开启「允许来自 Apple 事件的 JavaScript」，并在 macOS「隐私与安全性 → 自动化」允许本应用控制 Safari。', { cause: error });
  }
  return new Error(`Safari 操作失败：${details.trim().split('\n')[0]}`, { cause: error });
}

export async function openSafari(url, signal, mode = 'foreground') {
  const env = { ...process.env };
  delete env.XHS_AI_KEY;
  delete env.OPENAI_API_KEY;
  const run = async (args, useSignal = true) => {
    try {
      const result = await appleScript('/usr/bin/osascript', ['-e', safariScript, ...args], {
        env, timeout: 17000, maxBuffer: 4 * 1024 * 1024, ...(useSignal ? { signal } : {}),
      });
      return result.stdout.trim();
    } catch (error) {
      if (useSignal) signal?.throwIfAborted();
      throw safariError(error, args[0]);
    }
  };
  const id = await run(['open', url, mode], false);
  if (!/^\d+$/.test(id)) throw new Error('Safari 未返回监控窗口编号。');
  return {
    navigate: value => run(['navigate', id, value]),
    url: () => run(['url', id]),
    evaluate: async code => JSON.parse(await run(['evaluate', id, code])),
    mode: value => run([value, id]),
    close: () => run(['close', id], false),
  };
}

// Evaluated only in the dedicated monitoring window, on the active site's origin.
function pageRead(kind, value, allowedOrigins) {
  if (!allowedOrigins.includes(location.origin)) return JSON.stringify(null);
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const caption = element => (element.innerText ?? element.textContent ?? '').trim();
  const matching = (scope, expression) => Array.from(scope.querySelectorAll('button,[role=button],span,div,h1,h2,h3,h4,label,p'))
    .filter(element => visible(element) && expression.test(caption(element)))
    .sort((a, b) => a.childElementCount - b.childElementCount)[0];
  if (kind === 'state') return JSON.stringify({
    url: location.href,
    login: /扫码登录|登录后查看更多|请完成验证|安全验证|安全限制/.test(document.body?.innerText ?? ''),
    filter: Boolean(matching(document, /^(?:筛选|已筛选|搜索筛选)$/)),
    hasCards: Boolean(document.querySelector('section.note-item, .note-item, [data-note-id]')),
    empty: (document.body?.innerText ?? '').split('\n').map(text => text.trim()).filter(Boolean)
      .some(text => /^(?:没有找到相关笔记|没有找到相关内容|未找到相关笔记|未找到相关内容|暂无相关笔记|暂无搜索结果|没有搜索结果|暂无相关内容)[。！!]?$/.test(text)),
  });
  if (kind === 'openFilter') {
    const option = matching(document, /^(?:筛选|已筛选|搜索筛选)$/);
    if (!option) return JSON.stringify(false);
    option.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    option.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    if (!matching(document, /^发布时间$/)) option.click();
    return JSON.stringify(true);
  }
  if (kind === 'clickOption') {
    const heading = matching(document, /^发布时间$/);
    const sort = matching(document, /^排序依据$/);
    if (!heading || !sort) return JSON.stringify('');
    let panel = heading.parentElement;
    while (panel && !panel.contains(sort)) panel = panel.parentElement;
    const option = panel && matching(panel, new RegExp(value));
    if (!option) return JSON.stringify('');
    const label = caption(option);
    option.click();
    return JSON.stringify(label);
  }
  if (kind === 'cards') {
    const entries = Array.from(document.querySelectorAll('a[href]')).filter(anchor => {
      const rect = anchor.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
        rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && visible(anchor);
    }).map(anchor => {
      const card = anchor.closest('section.note-item, .note-item, [data-note-id]');
      const dates = card?.querySelectorAll('time, .time, .date, .publish-time, .publish-date, .note-time, .note-date');
      return { href: anchor.href, labels: Array.from(dates ?? [], element =>
        caption(element) || element.getAttribute('datetime') || '').filter(Boolean) };
    });
    return JSON.stringify({ entries, top: scrollY, height: document.scrollingElement?.scrollHeight ?? 0 });
  }
  if (kind === 'scroll') {
    scrollBy(0, Math.floor(innerHeight * 0.9));
    return JSON.stringify(true);
  }
  if (kind === 'note') {
    const title = caption(document.querySelector('#detail-title') ?? document.createElement('span'));
    const body = caption(document.querySelector('#detail-desc') ?? document.createElement('span'));
    const date = document.querySelector('.note-content .date, .note-scroller .bottom-container .date');
    return JSON.stringify({ title, body, dateLabel: date ? caption(date) : '', url: location.href });
  }
  return JSON.stringify(null);
}

function siteOrigins(origin) {
  return origin === site ? [site, 'https://xiaohongshu.com'] : [origin];
}

function sameNote(address, origins) {
  try {
    const url = new URL(address);
    const id = notePattern.exec(url.pathname)?.[1];
    return id && origins.includes(url.origin) && !url.username && !url.password ? { url, id } : null;
  } catch {
    return null;
  }
}

export async function collectSafari(keyword, range, ask, helpers, test = {}) {
  const { signal, presentation } = range;
  const origin = test.origin ?? site;
  const origins = siteOrigins(origin);
  const searchURL = new URL('/search_result', origin);
  searchURL.searchParams.set('keyword', keyword);
  const pause = ms => delay(ms, undefined, { signal });
  signal?.throwIfAborted();
  console.log('正在打开 Safari 监控窗口…');
  const browser = await (test.open ?? openSafari)(searchURL.href, signal, presentation?.mode);
  const read = (kind, value = null) => browser.evaluate(
    `(${pageRead.toString()})(${JSON.stringify(kind)},${JSON.stringify(value)},${JSON.stringify(origins)})`,
  );
  const setMode = async mode => {
    try { await browser.mode(mode); }
    catch (error) { if (!signal?.aborted) console.log(error.message); }
  };
  if (presentation) presentation.apply = setMode;
  const isSearch = address => {
    try {
      const url = new URL(address);
      return origins.includes(url.origin) && url.pathname.replace(/\/$/, '') === '/search_result' &&
        url.searchParams.get('keyword') === keyword;
    } catch { return false; }
  };
  const wait = async (predicate, ms = 6500) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      signal?.throwIfAborted();
      const result = await predicate();
      if (result) return result;
      await pause(250);
    }
    return null;
  };
  try {
    if (presentation?.mode === 'background') await setMode('background');
    const ready = () => wait(async () => {
      if (!origins.includes(new URL(await browser.url(), origin).origin)) return null;
      const state = await read('state');
      return state && (state.login || (isSearch(state.url) && (state.filter || state.hasCards || state.empty))) ? state : null;
    });
    let state = await ready();
    if (!state || state.login || !isSearch(state.url)) {
      await setMode('foreground');
      await ask('请在 Safari 监控窗口完成小红书登录或平台验证，然后点击「继续」。');
      await browser.navigate(searchURL.href);
      state = await ready();
    }
    if (!state || state.login || !isSearch(state.url)) throw new Error('Safari 未进入指定关键词的搜索结果页，请检查登录、验证或网络。');

    const eligible = helpers.presetsCovering(range.start);
    if (!eligible.length) throw new Error('目标开始日期超出网页「半年内」可覆盖的范围。');
    const choose = async expression => {
      await read('openFilter');
      return wait(() => read('clickOption', expression.source), 2500);
    };
    let pageFilter;
    if (state.filter) {
      const order = await choose(range.sort === '综合' ? /^综合$/ : /^最新$/);
      if (order) for (const [, expression] of eligible) {
        pageFilter = await choose(expression);
        if (pageFilter) break;
      }
    }
    if (!pageFilter) {
      await setMode('foreground');
      while (!pageFilter) {
        const choice = await ask(`先在 Safari 应用「${range.sort}」及覆盖 ${range.start} 至 ${range.end} 的发布时间。应用后选择同名时间选项；无合适选项请结束任务：`);
        if (!choice) throw new Error('尚未应用网页发布时间筛选。');
        if (eligible.some(([, expression]) => expression.test(choice))) pageFilter = `手动确认 · ${choice}`;
        else console.log(`「${choice}」可能漏掉目标日期开头的笔记，请选择更宽的时间范围。`);
      }
    }
    console.log(`网页发布时间筛选：${pageFilter}；排序：${range.sort}。`);
    await pause(1200);
    const cards = new Map();
    const toBottom = range.screens === 'bottom';
    let prior = '', stable = 0;
    for (let screen = 1; toBottom || screen <= range.screens; screen++) {
      signal?.throwIfAborted();
      if (!isSearch(await browser.url())) throw new Error('Safari 已离开目标关键词的搜索结果页。');
      const view = await read('cards');
      for (const card of view?.entries ?? []) {
        const address = sameNote(card.href, origins);
        if (!address) continue;
        const previous = cards.get(address.id);
        const date = card.labels.map(label => helpers.parseDisplayedDate(label)).find(Boolean) || previous?.date;
        if (!previous || address.url.searchParams.has('xsec_token')) {
          cards.set(address.id, { href: address.url.href, date });
        } else if (!previous.date && date) {
          cards.set(address.id, { ...previous, date });
        }
      }
      console.log(`扫描「${keyword}」 · 第 ${screen}${toBottom ? '' : `/${range.screens}`} 屏 · 候选 ${cards.size} 条`);
      if (!toBottom && screen === range.screens) break;
      const signature = JSON.stringify([view?.top, view?.height, view?.entries.map(card => card.href)]);
      stable = signature === prior ? stable + 1 : 0;
      prior = signature;
      if (toBottom && stable >= 3) break;
      await read('scroll');
      await pause(900);
    }
    if (!cards.size) {
      const current = await read('state');
      if (!current?.empty || current.login) throw new Error('Safari 未读取到笔记，且未能确认网页显示无结果。');
    }
    const all = [...cards.entries()];
    const unknownCardDates = all.filter(([, card]) => !card.date).length;
    const matched = all.filter(([, card]) => card.date >= range.start && card.date <= range.end);
    const notes = [];
    let unreadable = 0;
    for (const [id, card] of matched) {
      signal?.throwIfAborted();
      try {
        await browser.navigate(card.href);
        const detail = await wait(async () => {
          const opened = sameNote(await browser.url(), origins);
          if (opened?.id !== id) return null;
          const value = await read('note');
          const address = sameNote(value?.url, origins);
          return address?.id === id && (value.title || value.body) ? value : null;
        });
        if (!detail) throw new Error('未打开目标笔记');
        const direct = await wait(async () => {
          const opened = sameNote(await browser.url(), origins);
          return opened?.id === id && opened.url.pathname.startsWith('/explore/') ? opened.url.href : '';
        }, 3000);
        notes.push({ id, title: detail.title, body: detail.body, dateLabel: detail.dateLabel,
          date: helpers.parseDisplayedDate(detail.dateLabel), url: direct || '' });
      } catch (error) {
        signal?.throwIfAborted();
        unreadable++;
        console.log(`Safari 笔记读取失败：${error.message}`);
      }
      console.log(`读笔记 ${notes.length + unreadable}/${matched.length}`);
    }
    return { notes, unreadable, candidates: cards.size, pageFilter, unknownCardDates,
      outsideRange: all.length - unknownCardDates - matched.length, opened: matched.length };
  } finally {
    if (presentation) presentation.apply = null;
    await browser.close().catch(() => {});
  }
}
