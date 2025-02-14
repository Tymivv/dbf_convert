// GoogleSheetImporter.js
import React, { useState } from 'react';
import Modal from 'react-modal';
import style from '../app.module.css';
import './googleSheetImporter.css'; // стилі для цього компонента (за бажанням)
/* global chrome */

const GoogleSheetImporter = ({ onDataImported }) => {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [spreadsheetIdInput, setSpreadsheetIdInput] = useState('');
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [importedData, setImportedData] = useState([]);
  const [sheetsList, setSheetsList] = useState([]); // Список листів з таблиці
  const [selectedSheet, setSelectedSheet] = useState(''); // Обраний лист

  // Функція входу через Google (через chrome.identity)
  const signIn = () => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error('Помилка отримання токена:', chrome.runtime.lastError);
        setStatusMessage('Помилка: ' + chrome.runtime.lastError.message);
        return;
      }
      if (token) {
        setAccessToken(token);
        setIsSignedIn(true);
        setStatusMessage('Ви увійшли через Google.');
      } else {
        console.error('Токен OAuth був порожнім');
        setStatusMessage('Помилка: Токен OAuth був порожнім');
      }
    });
  };

  // Функція виходу
  const signOut = () => {
    if (accessToken) {
      chrome.identity.removeCachedAuthToken({ token: accessToken }, () => {
        setAccessToken(null);
        setIsSignedIn(false);
        setStatusMessage('Ви вийшли.');
      });
    } else {
      console.error('Немає токена для видалення');
      setStatusMessage('Помилка: Немає токена для видалення');
    }
  };

  // Допоміжна функція для вилучення ID таблиці з URL (якщо потрібно)
  const getSpreadsheetIdFromInput = (input) => {
    // Якщо input містить docs.google.com, спробуємо вилучити ID
    const regex = /\/d\/([a-zA-Z0-9-_]+)/;
    const match = input.match(regex);
    if (match && match[1]) {
      return match[1];
    }
    // Якщо просто введено ID – повертаємо його
    return input;
  };

// const importSpreadsheetData = async () => {
//   setStatusMessage('Імпорт даних...');
//   const spreadsheetId = getSpreadsheetIdFromInput(spreadsheetIdInput);
//   const range = 'Sheet1!A1:Z';
//   const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS`;
//   try {
//     const response = await fetch(url, {
//       method: 'GET',
//       headers: {
//         'Authorization': 'Bearer ' + accessToken,
//         'Content-Type': 'application/json'
//       }
//     });
//     const data = await response.json();
//     if (response.ok) {
//       if (data.values && data.values.length > 0) {
//         // Перший рядок – це заголовки
//         const headers = data.values[0];
//         // Решта рядків – це дані (можуть бути порожні, якщо імпортовано лише один рядок)
//         const rows = data.values.slice(1);
//         // Якщо потрібно перетворити рядки в об'єкти:
//         const imported = rows.map(row => {
//           const obj = {};
//           headers.forEach((header, index) => {
//             obj[header] = row[index] || '';
//           });
//           return obj;
//         });
//         setImportedData(imported);
//         setStatusMessage('Дані успішно імпортовано!');
//         // Передаємо об'єкт з headers та rows навіть якщо rows порожній
//         if (onDataImported) {
//           onDataImported({ headers, rows: imported });
//         }
//       } else {
//         setStatusMessage('Таблиця порожня або не містить даних.');
//       }
//     } else {
//       console.error('Помилка імпорту даних:', data);
//       setStatusMessage(`Помилка: ${data.error.message}`);
//     }
//   } catch (error) {
//     console.error('Помилка під час імпорту:', error);
//     setStatusMessage('Помилка під час імпорту: ' + error.message);
//   }
// };
  // Функція отримання списку листів з таблиці
  const fetchSheetsList = async (spreadsheetId) => {
    setStatusMessage("Отримання списку листів...");
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (response.ok) {
        const sheets = data.sheets.map(sheet => sheet.properties.title);
        setSheetsList(sheets);
        setSelectedSheet(sheets[0]); // За замовчуванням обираємо перший лист
        setStatusMessage("Список листів отримано.");
      } else {
        console.error('Помилка отримання списку листів:', data);
        setStatusMessage("Помилка отримання списку листів: " + data.error.message);
      }
    } catch (error) {
      console.error('Помилка отримання списку листів:', error);
      setStatusMessage("Помилка отримання списку листів: " + error.message);
    }
  };

  // Функція імпорту даних з обраного листа
  const importSpreadsheetData = async () => {
    if (!selectedSheet) {
      setStatusMessage("Оберіть лист для імпорту.");
      return;
    }
    setStatusMessage('Імпорт даних...');
    const spreadsheetId = getSpreadsheetIdFromInput(spreadsheetIdInput);
    // Використовуємо обраний лист для формування діапазону
    const range = `${selectedSheet}!A1:Z`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (response.ok) {
        if (data.values && data.values.length > 0) {
          const headers = data.values[0];
          const rows = data.values.slice(1);
          // Перетворюємо рядки у об'єкти
          const imported = rows.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
              obj[header] = row[index] || '';
            });
            return obj;
          });
          setImportedData(imported);
          setStatusMessage('Дані успішно імпортовано!');
          // Викликаємо callback з об'єктом { headers, rows: imported }
          if (onDataImported) {
            onDataImported({ headers, rows: imported });
          }
        } else {
          setStatusMessage('Таблиця порожня або не містить даних.');
        }
      } else {
        console.error('Помилка імпорту даних:', data);
        setStatusMessage(`Помилка: ${data.error.message}`);
      }
    } catch (error) {
      console.error('Помилка під час імпорту:', error);
      setStatusMessage('Помилка під час імпорту: ' + error.message);
    }
  };

  const openModal = () => {
    setModalIsOpen(true);
    setStatusMessage('');
    setImportedData([]);
    setSpreadsheetIdInput('');
    setSheetsList([]);
  };

  const closeModal = () => {
    setModalIsOpen(false);
    setStatusMessage('');
    setImportedData([]);
    setSpreadsheetIdInput('');
    setSheetsList([]);
  };

  return (
    <>
    <button className={style.btn} onClick={openModal}>
      Імпорт з Google таблиці
    </button>
    <Modal
      isOpen={modalIsOpen}
      onRequestClose={closeModal}
      contentLabel="Google Sheet Importer"
      ariaHideApp={false}
      className="Modal"
      overlayClassName="Overlay"
    >
      <div>
        <button className={style.closeModal} onClick={closeModal}>
          ✖
        </button>
        <h1 style={{ marginBottom: '20px' }}>Імпорт з Google таблиці</h1>
        {!isSignedIn ? (
          <button className={style.btn} onClick={signIn}>
            Увійти за допомогою Google
          </button>
        ) : (
          <button className={style.btn} onClick={signOut}>
            Вийти
          </button>
        )}
        {isSignedIn && (
          <>
            <div style={{ marginTop: '20px' }}>
              <label>
                Введіть посилання або ID таблиці:
                <input
                  type="text"
                  value={spreadsheetIdInput}
                  onChange={(e) => setSpreadsheetIdInput(e.target.value)}
                  style={{ width: '95%', padding: '8px', marginTop: '5px' }}
                />
              </label>
            </div>
            <div style={{ marginTop: '10px' }}>
              <button
                className={style.btn}
                onClick={() =>
                  fetchSheetsList(getSpreadsheetIdFromInput(spreadsheetIdInput))
                }
                disabled={!spreadsheetIdInput}
              >
                Отримати список листів
              </button>
            </div>
            {sheetsList.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <label>
                  Оберіть лист:
                  <select
                    className={style.btn}
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                    style={{ width: '95%', padding: '8px', marginTop: '5px' }}
                  >
                    {sheetsList.map((sheetName) => (
                      <option key={sheetName} value={sheetName}>
                        {sheetName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div style={{ marginTop: '20px' }}>
              <button
                className={style.btn}
                onClick={importSpreadsheetData}
                disabled={!selectedSheet}
              >
                Імпортувати дані
              </button>
            </div>
          </>
        )}
        {statusMessage && <p style={{ marginTop: '20px' }}>{statusMessage}</p>}
        {importedData && importedData.length > 0 && (
          <div style={{ marginTop: '20px', maxHeight: '300px', overflowY: 'auto' }}>
            <h2>Імпортовані дані:</h2>
            <table className={style.myTable}>
              <thead>
                <tr>
                  {importedData.length > 0 &&
                    Object.keys(importedData[0]).map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {importedData.map((row, index) => (
                  <tr key={index}>
                    {Object.values(row).map((cell, idx) => (
                      <td key={idx}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  </>
  );
};

export default GoogleSheetImporter;
