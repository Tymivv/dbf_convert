import React, { useState } from 'react';
import Modal from 'react-modal';
import './googleSheetUploader.css'; 
import style from '../app.module.css';
/* global chrome */

const GoogleSheetUploader = ({ dataArray }) => {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [spreadsheetLink, setSpreadsheetLink] = useState('');
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [accessToken, setAccessToken] = useState(null);

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
      } else {
        console.error('Токен OAuth був порожнім');
        setStatusMessage('Помилка: Токен OAuth був порожнім');
      }
    });
  };

  const signOut = () => {
    if (accessToken) {
      chrome.identity.removeCachedAuthToken({ token: accessToken }, () => {
        setAccessToken(null);
        setIsSignedIn(false);
      });
    } else {
      console.error('Немає токена для видалення');
      setStatusMessage('Помилка: Немає токена для видалення');
    }
  };

  const createSpreadsheet = async () => {
    setStatusMessage('Створення таблиці...');
  
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: `New Spreadsheet (${new Date().toLocaleString()})`,
        },
        sheets: [
          {
            properties: {
              title: 'Sheet1', // Встановлюємо назву листа на 'Sheet1'
            },
          },
        ],
      }),
    });
  
    const data = await response.json();
  
    if (response.ok) {
      const spreadsheetId = data.spreadsheetId;
      const link = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      setSpreadsheetLink(link);
  
      setStatusMessage('Таблицю створено. Завантаження даних...');
  
      return spreadsheetId;
    } else {
      console.error('Помилка створення таблиці:', data);
      setStatusMessage(`Помилка: ${data.error.message}`);
      throw new Error(data.error.message);
    }
  };
  

  const uploadDataToSpreadsheet = async (spreadsheetId) => {
    const headers = Object.keys(dataArray[0]);
    const values = dataArray.map(item => headers.map(header => item[header]));
    values.unshift(headers);
  
    console.log('Дані для завантаження:', values);
  
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=RAW`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: values,
        majorDimension: 'ROWS',
      }),
    });
  
    const data = await response.json();
  
    if (response.ok) {
      setStatusMessage('Дані успішно завантажено!');
    } else {
      console.error('Помилка завантаження даних:', data);
      setStatusMessage(`Помилка: ${data.error.message}`);
      throw new Error(`${data.error.message} (код помилки: ${data.error.code})`);
    }
  };
  
  

  const createAndUploadSpreadsheet = async () => {
    try {
      const spreadsheetId = await createSpreadsheet();
      await uploadDataToSpreadsheet(spreadsheetId);
    } catch (error) {
      console.error('Помилка під час створення або завантаження таблиці:', error);
    }
  };

  const openModal = () => {
    if (dataArray.length > 0) {
      setModalIsOpen(true);
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
