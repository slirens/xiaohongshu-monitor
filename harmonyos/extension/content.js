(() => {
  const origins = ['https://www.xiaohongshu.com', 'https://xiaohongshu.com'];
  const readKinds = ['state', 'openFilter', 'clickOption', 'cards', 'scroll', 'note'];
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'xhs-read' || sender.id !== chrome.runtime.id ||
        sender.url !== chrome.runtime.getURL('index.html') || !origins.includes(location.origin)) {
      return;
    }
    if (!readKinds.includes(message.kind) ||
        (message.kind === 'clickOption' && (typeof message.value !== 'string' || message.value.length > 160))) {
      respond({ ok: false, error: '无法识别这项网页操作。' });
      return;
    }
    try {
      respond({ ok: true, result: pageRead(message.kind, message.value, origins) });
    } catch {
      respond({ ok: false, error: '读取小红书网页时出错。请确认网页正常显示后重试。' });
    }
  });
})();
