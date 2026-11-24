import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const ui = (zh, en) => process.env.XHS_UI_LANG === 'en' ? en : zh;

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
  if (action === 'open' && (error.killed || /-1712/.test(details))) {
    return new Error('等待 Safari 打开监控窗口超时。请打开 Safari，处理浏览器或 macOS 弹出的授权提示后重试。', { cause: error });
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
        env, timeout: args[0] === 'open' ? 45000 : 17000, maxBuffer: 4 * 1024 * 1024, ...(useSignal ? { signal } : {}),
      });
      return result.stdout.trim();
    } catch (error) {
      if (useSignal) signal?.throwIfAborted();
      throw safariError(error, args[0]);
    }
  };
  const id = await run(['open', url, mode], false);
  if (!/^\d+$/.test(id)) throw new Error(ui('Safari 未返回监控窗口编号。', 'Safari did not return the monitoring window ID.'));
  return {
    navigate: value => run(['navigate', id, value]),
    url: () => run(['url', id]),
    evaluate: async code => {
      const result = await run(['evaluate', id, code]);
      return !result || result === 'missing value' ? null : JSON.parse(result);
    },
    mode: value => run([value, id]),
    close: () => run(['close', id], false),
  };
}

// Evaluated only in the dedicated monitoring window, on the active site's origin.
export function pageRead(kind, value, allowedOrigins) {
  if (!allowedOrigins.includes(location.origin)) return JSON.stringify(null);
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const caption = element => (element.innerText ?? element.textContent ?? '').trim();
  const label = element => caption(element).replace(/\s+/g, ' ');
  const matches = (scope, expression, include = () => true) => Array.from(scope.querySelectorAll('button,[role=button],[role=radio],[role=option],span,div,h1,h2,h3,h4,label,p'))
    .filter(element => include(element) && visible(element) && expression.test(label(element)))
    .sort((a, b) => a.childElementCount - b.childElementCount);
  const matching = (...args) => matches(...args)[0];
  const filterButton = /^(?:筛选|已筛选|搜索筛选)$/;
  const login = () => /^\/(?:login|website-login\/(?:login|verify))(?:\/|$)/.test(location.pathname) || Boolean(matching(document,
    /^(?:登录后查看搜索结果|登录后查看更多(?:内容|笔记|搜索结果)?|扫码登录|手机号登录|请完成(?:安全)?验证|安全验证|安全限制|Log in to view search results|Sign in to view search results)[。！!]?$/i)) ||
    Array.from(document.querySelectorAll('input[placeholder="输入手机号"]')).some(visible);
  if (kind === 'state') return JSON.stringify({
    url: location.href,
    login: login(),
    filter: Boolean(matching(document, filterButton)),
    hasCards: Boolean(document.querySelector('section.note-item, .note-item, [data-note-id]')),
    empty: (document.body?.innerText ?? '').split('\n').map(text => text.trim()).filter(Boolean)
      .some(text => /^(?:没有找到相关笔记|没有找到相关内容|未找到相关笔记|未找到相关内容|暂无相关笔记|暂无搜索结果|没有搜索结果|暂无相关内容)[。！!]?$/.test(text)),
  });
  if (kind === 'filters' || kind === 'openFilter' || kind === 'clickOption' || kind === 'clickTime') {
    const legacy = kind !== 'filters';
    if (login()) return JSON.stringify(legacy ? (kind === 'openFilter' ? false : '') : { login: true });
    const controlAt = element => {
      const control = element.closest('button,[role=button],[role=radio],[role=option]') ?? element;
      if (control.matches(':disabled') || control.closest('[aria-disabled=true],[inert]')) return null;
      const bounds = element.getBoundingClientRect();
      const left = Math.max(0, bounds.left), right = Math.min(innerWidth, bounds.right);
      const top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom);
      if (left >= right || top >= bottom) return null;
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return control.contains(hit) ? control : null;
    };
    const timeHeading = matching(document, /^发布时间$/);
    const sortHeading = matching(document, /^排序依据$/);
    let panel = sortHeading && timeHeading?.parentElement;
    while (panel && !panel.contains(sortHeading)) panel = panel.parentElement;
    if (panel && kind === 'openFilter') return JSON.stringify(true);
    if (!panel) {
      const button = matching(document, filterButton);
      const control = button && controlAt(button);
      if (control && (value?.action === 'hover' || kind === 'openFilter')) {
        control.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        control.dispatchEvent(new MouseEvent('mouseenter'));
      }
      if (control && (value?.action === 'open' || (kind === 'openFilter' && !matching(document, /^发布时间$/)))) control.click();
      return JSON.stringify(legacy ? (kind === 'openFilter' ? Boolean(control) : '') : { open: false });
    }
    const headings = ['排序依据', '笔记类型', '发布时间', '搜索范围', '位置距离', '发布地点'];
    const positionedBefore = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const ownGroup = (heading, expression) => {
      const boundary = headings.map(label => matching(panel, new RegExp(`^${label}$`)))
        .filter(element => element && positionedBefore(heading, element))
        .sort((a, b) => positionedBefore(a, b) ? -1 : 1)[0];
      return matches(panel, expression, element => positionedBefore(heading, element) && (!boundary || positionedBefore(element, boundary)));
    };
    const orders = ownGroup(sortHeading, /^(?:综合|最新|最多点赞|最多评论|最多收藏)$/);
    const times = ownGroup(timeHeading, /^(?:不限|全部|任意时间|一天内|1天内|24小时内|近24小时|最近24小时|今天|一周内|7天内|近7天|最近7天|最近一周|一星期内|半年内|六个月内|180天内|近半年)$/);
    if (value?.action === 'select' || kind === 'clickOption' || kind === 'clickTime') {
      const pool = value?.group === 'order' || kind === 'clickOption' ? orders : times;
      const pattern = legacy ? new RegExp(value) : null;
      const target = pool.find(element => pattern ? pattern.test(label(element)) : label(element) === value.label);
      const control = target && controlAt(target);
      if (control) {
        const clickedLabel = label(target);
        control.click();
        return JSON.stringify(legacy ? clickedLabel : { clicked: true });
      }
      return JSON.stringify(legacy ? '' : { clicked: false });
    }
    return JSON.stringify({ open: true, options: [...new Set(times.map(label))] });
  }
  if (kind === 'cards') {
    const top = scrollY, height = document.scrollingElement?.scrollHeight ?? 0;
    if (login()) return JSON.stringify({ login: true, entries: [], top, height });
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
    return JSON.stringify({ entries, top, height });
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

function siteAddress(address, origins) {
  try {
    const url = new URL(address);
    return origins.includes(url.origin) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function sameNote(address, origins) {
  const url = siteAddress(address, origins);
  const id = url && notePattern.exec(url.pathname)?.[1];
  return id ? { url, id } : null;
}

class SafariAccessRequired extends Error {}

export async function collectSafari(keyword, range, ask, helpers, test = {}) {
  const { signal, presentation } = range;
  const observe = range.observe ?? (() => {});
  const origin = test.origin ?? site;
  const origins = siteOrigins(origin);
  const searchURL = new URL('/search_result', origin);
  searchURL.searchParams.set('keyword', keyword);
  const pause = ms => delay(ms, undefined, { signal });
  signal?.throwIfAborted();
  console.log(ui('正在打开 Safari 监控窗口…', 'Opening the Safari monitoring window…'));
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
    const url = siteAddress(address, origins);
    return url?.pathname.replace(/\/$/, '') === '/search_result' && url.searchParams.get('keyword') === keyword;
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
    const ready = (allowLogin = true, timeout) => wait(async () => {
      if (!siteAddress(await browser.url(), origins)) return null;
      const state = await read('state');
      if (state?.login) return allowLogin ? state : null;
      return state && isSearch(state.url) && (state.filter || state.hasCards || state.empty) ? state : null;
    }, timeout);
    const resumeAfterSignIn = async retryNavigation => {
      for (let attempt = 0; ; attempt++) {
        await setMode('foreground');
        const answer = await ask(ui(`${attempt ? 'Safari 仍在等待登录。' : ''}请在 Safari 监控窗口完成小红书登录或平台验证，然后点击「继续」。`,
          `${attempt ? 'Safari is still waiting for sign-in. ' : ''}Sign in to Xiaohongshu or complete verification in the Safari monitoring window, then click Continue.`));
        signal?.throwIfAborted();
        if (presentation && answer !== '继续') throw new Error(ui('已结束等待 Safari 登录。', 'Safari sign-in was cancelled.'));
        const samePage = isSearch(await browser.url());
        if ((!attempt && retryNavigation) || !samePage) await browser.navigate(searchURL.href);
        const resumed = await ready(false, samePage ? 3000 : 6500);
        if (resumed) return;
        if (!(await read('state'))?.login) throw new Error(ui('Safari 未进入指定关键词的搜索结果页，请检查登录、验证或网络。',
          'Safari did not reach the requested results. Check sign-in, verification, and network access.'));
      }
    };
    const state = await ready();
    if (!state || state.login || !isSearch(state.url)) await resumeAfterSignIn(!state?.login);

    const toBottom = range.screens === 'bottom';
    const stopAtStart = toBottom && range.sort === '最新';
    const started = performance.now();
    const eligible = helpers.presetsCovering(range.start, new Date(), stopAtStart);
    observe('filter_started', { requestedSort: range.sort === '最新' ? 'latest' : 'relevance', eligiblePresets: eligible.length });
    if (!eligible.length) {
      observe('filter_failed', { stage: 'check_range', reason: 'range_not_supported' });
      throw new Error(ui('目标开始日期超出网页「半年内」可覆盖的范围。', 'The start date is outside the past six months.'));
    }
    const snapshot = async (value = null) => {
      const result = await read('filters', value);
      if (result?.login) throw new SafariAccessRequired();
      return result;
    };
    const visiblePanel = async () => {
      const current = await snapshot();
      return current?.open ? current : null;
    };
    const openFilters = async () => {
      const current = await visiblePanel();
      if (current) return current;
      await snapshot({ action: 'hover' });
      const hovered = await wait(visiblePanel, 900);
      if (hovered) return hovered;
      await snapshot({ action: 'open' });
      return wait(visiblePanel, 2500);
    };
    let pageFilter;
    let requestedTime;
    let stage = 'open_panel';
    try {
      while (!pageFilter) {
        try {
          stage = 'open_panel';
          const panel = await openFilters();
          if (!panel) throw new Error(ui('无法打开筛选面板。', 'The filter panel could not be opened.'));
          stage = 'select_sort';
          if (!(await snapshot({ action: 'select', group: 'order', label: range.sort }))?.clicked) {
            throw new Error(ui('无法点击指定的排序选项。', 'The requested sort option could not be clicked.'));
          }
          observe('filter_option_action', { stage, action: 'visible_control_click' });
          stage = 'find_time_options';
          const dates = await openFilters();
          const option = dates && eligible
            .map(([days, pattern]) => ({ days, name: dates.options.find(name => pattern.test(name)) }))
            .find(entry => entry.name);
          if (!option) throw new Error(ui('找不到覆盖目标日期的发布时间选项。', 'No publication-time option covers the requested dates.'));
          stage = 'select_time';
          if (!(await snapshot({ action: 'select', group: 'time', label: option.name }))?.clicked) {
            throw new Error(ui('无法点击指定的发布时间选项。', 'The requested publication time option could not be clicked.'));
          }
          observe('filter_option_action', { stage, action: 'visible_control_click' });
          await pause(1200);
          await snapshot();
          requestedTime = option.days === 1 ? 'day' : option.days === 7 ? 'week' : option.days === 180 ? 'six_months' : 'any_time';
          pageFilter = option.name;
        } catch (error) {
          if (!(error instanceof SafariAccessRequired)) throw error;
          observe('search_interaction_requested', { stage });
          await resumeAfterSignIn(false);
          observe('search_access_restored', { stage });
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      observe('filter_failed', { stage, reason: 'automatic_filter_failed', elapsedMs: Math.round(performance.now() - started) });
      throw new Error(ui(`Safari 网页自动筛选失败。本关键词已跳过。 ${error.message}`,
        `Safari could not apply the filters automatically. This keyword was skipped. ${error.message}`), { cause: error });
    }
    observe('filter_applied', { requestedSort: range.sort === '最新' ? 'latest' : 'relevance', requestedTime,
      elapsedMs: Math.round(performance.now() - started) });
    console.log(ui(`网页发布时间筛选：${pageFilter}；排序：${range.sort}。`, 'Publication date filter applied.'));
    const cards = new Map();
    let prior = '', stable = 0;
    for (let screen = 1; toBottom || screen <= range.screens; screen++) {
      signal?.throwIfAborted();
      if (!isSearch(await browser.url())) throw new Error(ui('Safari 已离开目标关键词的搜索结果页。', 'Safari left the requested search results.'));
      const view = await read('cards');
      if (view?.login) throw new Error(ui('Safari 在读取搜索结果时需要重新登录。', 'Safari requested sign-in while reading the search results.'));
      let olderDate;
      for (const card of view?.entries ?? []) {
        const address = sameNote(card.href, origins);
        if (!address) continue;
        const previous = cards.get(address.id);
        const visibleDate = card.labels.map(label => helpers.parseDisplayedDate(label)).find(Boolean);
        if (stopAtStart && visibleDate && visibleDate < range.start) olderDate ??= visibleDate;
        const date = visibleDate || previous?.date;
        if (!previous || address.url.searchParams.has('xsec_token')) {
          cards.set(address.id, { href: address.url.href, date });
        } else if (!previous.date && date) {
          cards.set(address.id, { ...previous, date });
        }
      }
      const screenLabel = `${screen}${toBottom ? '' : `/${range.screens}`}`;
      console.log(ui(`扫描「${keyword}」 · 第 ${screenLabel} 屏 · 候选 ${cards.size} 条`,
        `Scanning “${keyword}” · Screen ${screenLabel} · ${cards.size} candidates`));
      if (olderDate) {
        console.log(ui(`发现发布日期 ${olderDate} 早于开始日期 ${range.start}，已扫完本屏并停止「${keyword}」划屏。`,
          `Found a note dated ${olderDate}, before ${range.start}. Finished this screen and stopped scrolling for “${keyword}”.`));
        break;
      }
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
      if (!current?.empty || current.login) throw new Error(ui('Safari 未读取到笔记，且未能确认网页显示无结果。', 'Safari found no readable notes and could not verify an empty result.'));
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
        if (!detail) throw new Error(ui('未打开目标笔记', 'The note could not be opened.'));
        const direct = await wait(async () => {
          const opened = sameNote(await browser.url(), origins);
          return opened?.id === id && opened.url.pathname.startsWith('/explore/') ? opened.url.href : '';
        }, 3000);
        notes.push({ id, title: detail.title, body: detail.body, dateLabel: detail.dateLabel,
          date: helpers.parseDisplayedDate(detail.dateLabel), url: direct || '' });
      } catch (error) {
        signal?.throwIfAborted();
        unreadable++;
        console.log(ui(`Safari 笔记读取失败：${error.message}`, `Could not read the note in Safari: ${error.message}`));
      }
      console.log(ui(`读笔记 ${notes.length + unreadable}/${matched.length}`, `Reading notes ${notes.length + unreadable}/${matched.length}`));
    }
    return { notes, unreadable, candidates: cards.size, pageFilter, unknownCardDates,
      outsideRange: all.length - unknownCardDates - matched.length, opened: matched.length };
  } finally {
    if (presentation) presentation.apply = null;
    await browser.close().catch(() => {});
  }
}
