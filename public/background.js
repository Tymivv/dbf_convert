// eslint-disable-next-line no-undef
chrome.action.onClicked.addListener((tab) => {
  // Відкриваємо опційну сторінку
  // eslint-disable-next-line no-undef
  chrome.runtime.openOptionsPage();

  // Отримуємо токен авторизації
  // eslint-disable-next-line no-undef
  chrome.identity.getAuthToken({ interactive: true }, function (token) {
    // eslint-disable-next-line no-undef
    if (chrome.runtime.lastError || !token) {
      // eslint-disable-next-line no-undef
      console.error('Помилка отримання токена:', chrome.runtime.lastError);
      return;
    }
    console.log('Отримано токен доступу:', token);

    // Використання токена, наприклад, для виклику Google API
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(response => response.json())
      .then(data => console.log('Дані користувача:', data))
      .catch(err => console.error('Помилка при запиті до API:', err));
  });
});
