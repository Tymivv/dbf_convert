// GoogleSheetImporter.jsx
import React, { useState } from 'react';
import Modal from 'react-modal';
import style from '../app.module.css';
/* global chrome */

const GoogleSheetImporter = ({ onDataImported }) => {

const [isSignedIn, setIsSignedIn] = useState(false);// Чи користувач увійшов у систему Google
const [accessToken, setAccessToken] = useState(null);// Токен доступу (OAuth), який використовується для запитів до API Google
// Повідомлення для інформування користувача про статус операцій (помилки або успіх)
const [statusMessage, setStatusMessage] = useState('');
const [spreadsheetIdInput, setSpreadsheetIdInput] = useState('');// Збереження введеного посилання або ID Google таблиці
const [sheetsList, setSheetsList] = useState([]);// Список листів (назви листів) з вибраної Google таблиці
const [selectedSheet, setSelectedSheet] = useState('');// Назва обраного листа, з якого буде імпортовано дані
const [driveFiles, setDriveFiles] = useState([]);// Список Google таблиць, отриманих із Google Drive (відсортованих за датою змін)
const [showDriveList, setShowDriveList] = useState(false);// Прапорець, який визначає, чи слід відображати список таблиць з Google Drive
const [modalIsOpen, setModalIsOpen] = useState(false);// Прапорець, що вказує, чи відкрите модальне вікно імпорту

// Імпортовані дані з Google таблиці (масив об'єктів, де кожен об'єкт представляє рядок)
const [importedData, setImportedData] = useState([]);

  // Функції входу/виходу (як раніше)
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
      }
    });
  };

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

  // Допоміжна функція для вилучення ID таблиці з URL або тексту
  const getSpreadsheetIdFromInput = (input) => {
    const regex = /\/d\/([a-zA-Z0-9-_]+)/;
    const match = input.match(regex);
    return match && match[1] ? match[1] : input;
  };

  // Функція для отримання списку листів конкретної таблиці (як раніше)
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
        setSelectedSheet(sheets[0]); // За замовчуванням вибираємо перший лист
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

  // отримання списку Google таблиць з Google Drive
  const fetchDriveSpreadsheets = async () => {
    setStatusMessage("Отримання списку таблиць з Google Drive...");
    try {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.spreadsheet'",
        orderBy: "modifiedTime desc",
        pageSize: "10",
        fields: "files(id, name, modifiedTime)"
      });
      const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Content-Type": "application/json"
        }
      });
      const data = await response.json();
      if (response.ok) {
        setDriveFiles(data.files);
        setShowDriveList(true);
        setStatusMessage("Список таблиць отримано.");
      } else {
        console.error('Помилка отримання таблиць:', data);
        setStatusMessage("Помилка отримання таблиць: " + data.error.message);
      }
    } catch (error) {
      console.error('Помилка отримання таблиць:', error);
      setStatusMessage("Помилка отримання таблиць: " + error.message);
    }
  };

  // Функція імпорту даних з обраного листа таблиці (як раніше)
  const importSpreadsheetData = async () => {
    if (!selectedSheet) {
      setStatusMessage("Оберіть лист для імпорту.");
      return;
    }
    setStatusMessage('Імпорт даних...');
    const spreadsheetId = getSpreadsheetIdFromInput(spreadsheetIdInput);
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
          const imported = rows.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
              obj[header] = row[index] || '';
            });
            return obj;
          });
          setImportedData(imported);
          setStatusMessage('Дані успішно імпортовано!');
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
    setSelectedSheet('');
    setDriveFiles([]);
    setShowDriveList(false);
  };

  const closeModal = () => {
    setModalIsOpen(false);
    setStatusMessage('');
    setImportedData([]);
    setSpreadsheetIdInput('');
    setSheetsList([]);
    setSelectedSheet('');
    setDriveFiles([]);
    setShowDriveList(false);
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
                <button className={style.btn} onClick={fetchDriveSpreadsheets}>
                  Показати список таблиць з Google Drive
                </button>
              </div>
              {showDriveList && driveFiles.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <h2>Список таблиць:</h2>
                  <ul style={{ marginTop: 10, overflowX: "auto", maxWidth: "100%", maxHeight:"200px" }}>
                    {driveFiles.map(file => (
                      <li style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}key={file.id}>
                        <div>{file.name} <br />(Останнє редагування: {new Date(file.modifiedTime).toLocaleString()})</div>
                        <button
                          className={style.btn}
                          onClick={() => {
                            // Встановлюємо ID таблиці з Drive
                            setSpreadsheetIdInput(file.id);
                            setShowDriveList(false);
                            setStatusMessage(`Вибрано таблицю: ${file.name}`);
                          }}
                        >
                          Вибрати
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
                      value={selectedSheet}
                      onChange={(e) => setSelectedSheet(e.target.value)}
                      style={{ width: '100%', padding: '8px', marginTop: '5px' }}
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
              <div style={{ marginTop: '10px' }}>
                <button
                  className={style.btn}
                  onClick={importSpreadsheetData}
                  disabled={!selectedSheet && !spreadsheetIdInput}
                >
                  Імпортувати дані
                </button>
              </div>
            </>
          )}
          {statusMessage && <p style={{ marginTop: '20px' }}>{statusMessage}</p>}
          {/* {importedData && importedData.length > 0 && (
            <div style={{ marginTop: '20px', maxHeight: '300px', overflowY: 'auto' }}>
              <h2>Імпортовані дані:</h2>
              <table className={style.myTable}>
                <thead>
                  <tr>
                    {importedData.length > 0 &&
                      Object.keys(importedData).map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {importedData.map((row, index) => (
                    <tr key={index}>
                      {Object.values(row[0]).map((cell, idx) => (
                        <td key={idx}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )} */}
        </div>
      </Modal>
    </>
  );
};

export default GoogleSheetImporter;
