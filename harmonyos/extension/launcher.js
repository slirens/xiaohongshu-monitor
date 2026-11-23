const openButton = document.querySelector('#open');
const errorMessage = document.querySelector('#error');
openButton.addEventListener('click', () => {
  if (typeof globalThis.chrome?.tabs?.create !== 'function') {
    errorMessage.textContent = '请更新华为浏览器后重试。';
    return;
  }
  openButton.disabled = true;
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }, () => {
    if (chrome.runtime.lastError) {
      errorMessage.textContent = '无法打开监控工作台，请重试。';
      openButton.disabled = false;
      return;
    }
    window.close();
  });
});
