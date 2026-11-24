const systemLanguage = globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en';
export const english = !/^zh(?:[-_]|$)/i.test(systemLanguage);

export const t = (chinese, englishText) => english ? englishText : chinese;

export function localizePage() {
  document.documentElement.lang = t('zh-CN', 'en');
  if (!english) return;
  for (const element of document.querySelectorAll('[data-en]')) element.textContent = element.dataset.en;
  for (const element of document.querySelectorAll('[data-en-placeholder]')) {
    element.placeholder = element.dataset.enPlaceholder;
  }
  for (const element of document.querySelectorAll('[data-en-aria]')) {
    element.setAttribute('aria-label', element.dataset.enAria);
  }
}

// Keep the original value so it can be compared with Xiaohongshu's webpage.
export function dateFilterCaption(value) {
  if (!english) return value;
  const label = {
    不限: 'Any time',
    一天内: 'Past day',
    一周内: 'Past week',
    半年内: 'Past six months',
    近一天: 'Past day',
    近一周: 'Past week',
    近半年: 'Past six months',
  }[value];
  return label ? label + ' (' + value + ')' : value;
}

export function visibleError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!english) return message;
  if (/^报告模板无效/.test(message)) return 'Invalid report template. Check its Markdown and report schema.';
  if (/^AI .+(须为|与模板|字段「)/.test(message)) return 'The AI response does not match the report template.';
  if (/^工作簿过大/.test(message)) return 'The workbook is too large. Use a shorter date range or fewer keywords.';
  if (/^读取小红书网页时出错/.test(message)) return 'Could not read the Xiaohongshu page. Check that it loaded correctly, then try again.';
  if (/^无法识别这项网页操作/.test(message)) return 'Unrecognized website action.';
  return message;
}
