import React, { useState, useEffect } from 'react';
import { gapi } from 'gapi-script';
import Modal from 'react-modal';
import './googleSheetUploader.css'; 
import style from '../app.module.css';

// Ідентифікатор клієнта OAuth 2.0
const CLIENT_ID = process.env.REACT_APP_CLIENT_ID;
// API ключ для доступу до Google API
const API_KEY = process.env.REACT_APP_API_KEY;


const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

const GoogleSheetUploader = ({ dataArray }) => {
  // Статус входу користувача
  const [isSignedIn, setIsSignedIn] = useState(false);
  // Повідомлення про статус операцій
  const [statusMessage, setStatusMessage] = useState('');
  const [spreadsheetLink, setSpreadsheetLink] = useState('');
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [isApiInitialized, setIsApiInitialized] = useState(false); // Додаємо стан для перевірки ініціалізації API

  // Ініціалізація клієнта Google API
  const initClient = () => {
    gapi.load('client:auth2', () => {
      gapi.client
        .init({
          apiKey: API_KEY, // API ключ
          clientId: CLIENT_ID, // Ідентифікатор клієнта
          scope: SCOPES, // Область доступу
        })
        .then(() => {
          return gapi.client.load('sheets', 'v4'); // Завантаження Google Sheets API
        })
        .then(() => {
          if (gapi.auth2) {
            const authInstance = gapi.auth2.getAuthInstance();
            // Оновлення статусу входу
            setIsSignedIn(authInstance.isSignedIn.get());
            authInstance.isSignedIn.listen(setIsSignedIn); // Слухач змін статусу
            setIsApiInitialized(true); // Встановлюємо стан ініціалізації
          } else {
            console.error('gapi.auth2 не знайдено. Перевірте ініціалізацію Google API.');
          }
        })
        .catch((error) => {
          console.error('Помилка ініціалізації Google API:', error);
        });
    });
  };

  // Вхід у Google
  const signIn = () => {
    if (!isApiInitialized) {
      console.error('API ще не ініціалізовано');
      setStatusMessage('Помилка: Google API ще не готовий');
      return;
    }
    const authInstance = gapi.auth2?.getAuthInstance();
    if (!authInstance) {
      console.error('gapi.auth2 не ініціалізовано');
      setStatusMessage('Помилка: gapi.auth2 не готовий');
      return;
    }
    authInstance.signIn();
  };

  // Вихід з Google
  const signOut = () => {
    if (!isApiInitialized) {
      console.error('API ще не ініціалізовано');
      setStatusMessage('Помилка: Google API ще не готовий');
      return;
    }
    const authInstance = gapi.auth2?.getAuthInstance();
    if (!authInstance) {
      console.error('gapi.auth2 не ініціалізовано');
      setStatusMessage('Помилка: gapi.auth2 не готовий');
      return;
    }
    authInstance.signOut();
  };
  
  // Створення нової Google Таблиці та завантаження даних
  const createAndUploadSpreadsheet = async () => {
    setStatusMessage('Створення таблиці...');

    try {
      // Конвертування об'єктів у масиви для Google Sheets
      const headers = Object.keys(dataArray[0]); // Заголовки колонок
      const values = dataArray.map(item => headers.map(header => item[header]));
      values.unshift(headers); // Додати заголовки як перший рядок

      // Запит на створення нової Google Таблиці
      const response = await gapi.client.sheets.spreadsheets.create({
        properties: {
          title: `New Spreadsheet (${new Date().toLocaleString()})`, // Унікальна назва таблиці з часовою позначкою
        },
        sheets: [
          {
            properties: {
              title: 'Sheet1',
            },
          },
        ],
      });

      const spreadsheetId = response.result.spreadsheetId; // ID створеної таблиці
      const link = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      setSpreadsheetLink(link);

      setStatusMessage('Таблицю створено. Завантаження даних...');

      // Завантаження даних у таблицю
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId, // ID таблиці
        range: 'Sheet1!A1', // Вказуємо правильний діапазон, починаючи з комірки A1
        valueInputOption: 'RAW', // Введення даних у "сирому" форматі
        resource: {
          values, // Дані для завантаження
        },
      });

      setStatusMessage(`Дані успішно завантажено!`);
    } catch (error) {
      console.error('Помилка під час створення або завантаження таблиці:', error);
      setStatusMessage(`Помилка: ${error.result?.error?.message || 'Невідома помилка'}`);
    }
  };

  
  // Ініціалізація клієнта при завантаженні компонента
  useEffect(() => {
    initClient();
  }, []);
  const openModal = () => {
    if (dataArray.length > 0) {
      setModalIsOpen(true); // Готово для завантаження
    } else {
      alert("Завантажте таблицю та оберіть її кодування");
    }
    
  };

  const closeModal = () => {
    setModalIsOpen(false);
    setSpreadsheetLink('');
    setStatusMessage('');
  };

  return (
    <>
      <button className={style.btn} onClick={openModal}>Експорт в Google таблицю</button>
      <Modal
        isOpen={modalIsOpen}
        onRequestClose={closeModal}
        contentLabel="Google Sheet Uploader"
        ariaHideApp={false}
        className="Modal"
        overlayClassName="Overlay"
      >
        <div>
          <button 
          className={style.closeModal}
          onClick={closeModal}>
            ✖
          </button>
          <h1 style={{ marginBottom: '20px' }}>Експорт в Google таблицю</h1>
          {!isSignedIn ? (
            <button className={style.btn} onClick={signIn}>Увійти за допомогою Google</button>
          ) : (
            <button className={style.btn} onClick={signOut}>Вийти</button>
          )}
          <button className={style.btn} onClick={createAndUploadSpreadsheet} disabled={!isSignedIn}>
            Створити та завантажити таблицю
          </button>
          {statusMessage && <p style={{ marginTop: '20px' }}>{statusMessage}</p>}
          {spreadsheetLink && (
            <p>
              <a href={spreadsheetLink} target="_blank" rel="noopener noreferrer">
                Відкрити таблицю
              </a>
            </p>
          )}
        </div>
      </Modal>
    </>
  );
};

export default GoogleSheetUploader;
