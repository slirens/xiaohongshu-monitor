export const engagementMetrics = ['likes', 'saves', 'comments'];

export function normalizeEngagement(counts) {
  return Object.fromEntries(engagementMetrics.map(key => {
    const text = typeof counts?.[key] === 'string' ? counts[key].trim().replaceAll('，', ',') : '';
    const value = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text) ? Number(text.replaceAll(',', '')) : counts?.[key];
    return [key, Number.isSafeInteger(value) && value >= 0 ? value : null];
  }));
}

// Runs in the browser. Keep selectors scoped to the note's own interaction bar.
export function readEngagementLabels(document) {
  const bars = document.querySelectorAll('.interact-container, .engage-bar, .interaction-bar, .note-interact');
  const fields = [
    ['likes', '.like-wrapper, [data-testid="like-button"], button[aria-label^="点赞"]', '点赞'],
    ['saves', '.collect-wrapper, .save-wrapper, [data-testid="collect-button"], button[aria-label^="收藏"]', '收藏'],
    ['comments', '.chat-wrapper, .comment-wrapper, [data-testid="comment-button"], button[aria-label^="评论"]', '评论'],
  ];
  const result = {};
  for (const [key, selector, label] of fields) {
    for (const bar of bars) {
      const control = bar.querySelector(selector);
      if (!control || control.getClientRects().length === 0) continue;
      const count = control.querySelector('.count, [data-count], [data-testid="count"]');
      const values = [
        count?.getAttribute('data-count'), count?.getAttribute('title'), count?.textContent,
        control.getAttribute('data-count'), control.getAttribute('title'), control.getAttribute('aria-label'),
      ];
      for (const value of values) {
        const parsed = value?.trim().match(new RegExp('^(?:' + label + '[：:\\s]*)?(\\d+(?:[,，]\\d{3})*)(?:\\s*' + label + ')?$'));
        if (parsed) {
          result[key] = parsed[1];
          break;
        }
      }
      if (Object.hasOwn(result, key)) break;
    }
  }
  return result;
}
