import { parseDisplayedDate, presetsCovering } from './dates.mjs';
import { ReportNote, KeywordReport } from './workbook.mjs';
import { checkAbort } from './cancel.mjs';
import { dateFilterCaption, t } from './i18n.mjs';

const base = 'https://www.xiaohongshu.com';
const hosts = [base, 'https://xiaohongshu.com'];
const notePath = /^\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{24})\/?$/i;

function address(value) {
  try {
    const url = new URL(value);
    return hosts.includes(url.origin) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function noteAddress(value) {
  const url = address(value);
  const id = url?.pathname.match(notePath)?.[1];
  return id ? { id, url } : null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function collectKeyword(browser, keyword, range, ask, progress, signal) {
  const search = new URL('/search_result', base);
  search.searchParams.set('keyword', keyword);
  const isSearch = value => {
    const url = address(value);
    return url?.pathname.replace(/\/$/, '') === '/search_result' && url.searchParams.get('keyword') === keyword;
  };
  const wait = async (check, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      checkAbort(signal);
      const value = await check();
      if (value) return value;
      await sleep(280);
    }
    return null;
  };
  const state = () => browser.evaluate('state');
  const waitForResults = () => wait(async () => {
    const found = await state();
    if (found?.login) return found;
    return found && isSearch(found.url) && (found.filter || found.hasCards || found.empty) ? found : null;
  }, 12000);
  const stopAtStart = !range.screens && range.sort === '最新';
  const eligible = presetsCovering(range.start, new Date(), stopAtStart);
  if (!eligible.length) throw new Error(t('目标日期超出网页发布时间筛选可覆盖的范围。', 'The selected dates are outside the range supported by the website’s date filter.'));

  progress(t(`正在搜索「${keyword}」`, `Searching for “${keyword}”`));
  await browser.navigate(search.href);
  let found = await waitForResults();
  if (found?.login) {
    await ask(t('请在采集标签页完成小红书登录或平台要求的验证，然后返回扩展页继续。', 'Sign in to Xiaohongshu or complete its verification in the collection tab, then return here to continue.'));
    checkAbort(signal);
    await browser.navigate(search.href);
    found = await waitForResults();
  }
  if (!found || found.login || !isSearch(found.url)) throw new Error(t('未能进入目标搜索页，请检查登录和网页状态后重试。', 'Could not open the requested search. Check that you are signed in and the page is available, then try again.'));

  const choose = async (kind, expression) => {
    await browser.evaluate('openFilter');
    return wait(() => browser.evaluate(kind, expression.source), 2500);
  };
  let dateFilter = '';
  if (found.filter) {
    const order = await choose('clickOption', range.sort === '综合' ? /^综合$/ : /^最新$/);
    if (order) for (const [, expression] of eligible) {
      dateFilter = await choose('clickTime', expression);
      if (dateFilter) break;
    }
  }
  if (!dateFilter) {
    const choices = eligible.map(([days]) => days === Infinity ? '不限' : days === 1 ? '一天内' : days === 7 ? '一周内' : '半年内');
    const order = range.sort === '综合' ? 'Relevance (综合)' : 'Latest (最新)';
    const selected = await ask(t(`请在采集标签页应用「${range.sort}」排序及覆盖目标日期的发布时间，再返回并选择网页上的同名选项。`, `In the collection tab, sort by ${order} and choose a publication date filter that covers the selected dates. Return here and select the same option.`), choices);
    checkAbort(signal);
    if (!choices.includes(selected) || !isSearch(await browser.url())) throw new Error(t('网页时间筛选未确认。', 'The website’s date filter was not confirmed.'));
    dateFilter = selected;
  }
  progress(t(`网页发布时间 · ${dateFilter}`, `Publication date · ${dateFilterCaption(dateFilter)}`));
  await sleep(1000);

  const cards = new Map();
  let previous = '', unchanged = 0;
  for (let screen = 1; !range.screens || screen <= range.screens; screen++) {
    checkAbort(signal);
    if (!isSearch(await browser.url())) throw new Error(t('采集标签页已离开搜索结果。', 'The collection tab left the search results.'));
    const view = await browser.evaluate('cards');
    if (!view) throw new Error(t('未能读取搜索结果卡片。', 'Could not read the search result cards.'));
    let olderDate;
    for (const card of view.entries) {
      const note = noteAddress(card.href);
      if (!note) continue;
      const old = cards.get(note.id);
      const visibleDate = card.labels.map(label => parseDisplayedDate(label)).find(Boolean);
      if (stopAtStart && visibleDate && visibleDate < range.start) olderDate ??= visibleDate;
      const date = visibleDate || old?.date;
      const href = !old || (!old.token && note.url.searchParams.has('xsec_token')) ? note.url.href : old.href;
      cards.set(note.id, { date, href, token: new URL(href).searchParams.has('xsec_token') });
    }
    progress(t(`「${keyword}」第 ${screen} 屏 · ${cards.size} 条候选`, `“${keyword}” · Screen ${screen} · ${cards.size} ${cards.size === 1 ? 'candidate' : 'candidates'}`));
    if (olderDate) {
      progress(t(`发现发布日期 ${olderDate} 早于开始日期 ${range.start}，已扫完本屏并停止「${keyword}」划屏。`, `Found a note dated ${olderDate}, before ${range.start}. Finished this screen and stopped scrolling for “${keyword}”.`));
      break;
    }
    if (screen === range.screens) break;
    const position = JSON.stringify([view.top, view.height, view.entries.map(card => card.href)]);
    unchanged = position === previous ? unchanged + 1 : 0;
    previous = position;
    if (!range.screens && unchanged >= 3) break;
    await browser.evaluate('scroll');
    await sleep(850);
  }
  if (!cards.size) {
    const current = await state();
    if (!current?.empty || current.login) throw new Error(t('网页没有返回可读取的笔记。', 'The website returned no notes that could be read.'));
  }

  const inRange = [...cards].filter(([, card]) => card.date && card.date >= range.start && card.date <= range.end);
  const notes = [];
  for (const [index, [id, card]] of inRange.entries()) {
    checkAbort(signal);
    await browser.navigate(card.href);
    const detail = await wait(async () => {
      const current = noteAddress(await browser.url());
      if (current?.id !== id || !current.url.pathname.startsWith('/explore/')) return null;
      const note = await browser.evaluate('note');
      const confirmed = noteAddress(note?.url);
      if (confirmed?.id === id && confirmed.url.pathname.startsWith('/explore/') && (note.title || note.body)) {
        return { note, url: confirmed.url.href };
      }
      return null;
    }, 7000);
    if (detail) {
      const { note, url } = detail;
      const date = parseDisplayedDate(note.dateLabel);
      if (date >= range.start && date <= range.end && (note.title + ' ' + note.body).toLowerCase().includes(keyword.toLowerCase())) {
        notes.push(new ReportNote(note.title, note.body, url, date));
      }
    } else {
      progress(t(`第 ${index + 1} 条笔记无法确认原文地址，已跳过。`, `Skipped note ${index + 1} because its original link could not be confirmed.`));
    }
    progress(t(`「${keyword}」已读取 ${index + 1}/${inRange.length} 条`, `“${keyword}” · Read ${index + 1}/${inRange.length} notes`));
  }
  return new KeywordReport(keyword, notes);
}
