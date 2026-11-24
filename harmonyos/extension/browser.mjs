import { t, visibleError } from './i18n.mjs';

const origins = new Set(['https://www.xiaohongshu.com', 'https://xiaohongshu.com']);

function validateAddress(address) {
  const url = new URL(address);
  if (!origins.has(url.origin) || url.username || url.password) {
    throw new Error(t('监控标签页仅支持小红书网页。', 'The collection tab only supports Xiaohongshu pages.'));
  }
  return url.href;
}

function tabsCall(method, ...args) {
  return new Promise((resolve, reject) => {
    const tabs = globalThis.chrome?.tabs;
    if (typeof tabs?.[method] !== 'function') {
      reject(new Error(t('当前浏览器缺少扩展标签页接口。请更新华为浏览器后重试。', 'This browser does not support the required tab controls. Update Huawei Browser and try again.')));
      return;
    }
    tabs[method](...args, result => {
      const error = globalThis.chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

export async function openBrowser(address) {
  const url = validateAddress(address);
  const dashboard = await tabsCall('getCurrent');
  if (!Number.isInteger(dashboard?.id)) throw new Error(t('请在扩展的监控工作台中开始任务。', 'Start the task from the extension dashboard.'));
  const tab = await tabsCall('create', { url, active: true, windowId: dashboard.windowId, openerTabId: dashboard.id });
  if (!Number.isInteger(tab?.id)) throw new Error(t('未能打开小红书监控标签页。', 'Could not open the Xiaohongshu collection tab.'));
  const id = tab.id;
  let closed = false;

  return {
    async navigate(next) {
      await tabsCall('update', id, { url: validateAddress(next) });
    },
    async url() {
      return (await tabsCall('get', id)).url ?? '';
    },
    async evaluate(kind, value = null) {
      let response;
      try {
        response = await tabsCall('sendMessage', id, { type: 'xhs-read', kind, value });
      } catch (error) {
        if (/receiving end does not exist|message port closed|message channel closed/i.test(error.message)) return null;
        throw error;
      }
      if (!response) return null;
      if (!response.ok) throw new Error(visibleError(response.error));
      return JSON.parse(response.result);
    },
    async mode(mode) {
      if (mode !== 'foreground' && mode !== 'background') throw new Error(t('无法识别这项标签页操作。', 'Unrecognized tab action.'));
      await tabsCall('update', mode === 'foreground' ? id : dashboard.id, { active: true });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await tabsCall('remove', id);
      } catch (error) {
        if (!/no tab with id|invalid tab id/i.test(error.message)) throw error;
      }
    }
  };
}
