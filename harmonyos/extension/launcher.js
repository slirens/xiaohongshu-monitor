import { localizePage, t } from './i18n.mjs';

localizePage();

const openButton = document.querySelector('#open');
const errorMessage = document.querySelector('#error');
openButton.addEventListener('click', () => {
  if (typeof globalThis.chrome?.tabs?.create !== 'function') {
    errorMessage.textContent = t('请更新华为浏览器后重试。', 'Update Huawei Browser and try again.');
    return;
  }
  openButton.disabled = true;
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }, () => {
    if (chrome.runtime.lastError) {
      errorMessage.textContent = t('无法打开监控工作台，请重试。', 'Could not open the dashboard. Try again.');
      openButton.disabled = false;
      return;
    }
    window.close();
  });
});
