// background.js
// eslint-disable-next-line no-undef
chrome.action.onClicked.addListener((tab) => {
  // eslint-disable-next-line no-undef
  chrome.runtime.openOptionsPage();

  // eslint-disable-next-line no-undef
  chrome.identity.getAuthToken({ interactive: true }, function (token) {
    // eslint-disable-next-line no-undef
    if (chrome.runtime.lastError || !token) {
      // eslint-disable-next-line no-undef
      console.error('Помилка отримання токена:', chrome.runtime.lastError);
      return;
    }
    console.log('Отримано токен доступу:', token);

    // Отправляем токен в компонент
    // eslint-disable-next-line no-undef
    chrome.runtime.sendMessage({ type: 'AUTH_TOKEN', token });
  });
});
