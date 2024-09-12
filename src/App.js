import React, { useState, useRef, useEffect } from "react";
import { read, utils, writeFileXLSX } from 'xlsx';
import style from './app.module.css';
import iconv from 'iconv-lite';
import { Buffer } from 'buffer';
window.Buffer = window.Buffer || require("buffer").Buffer;

const decodeString = (str, encoding) => {
  try {
    const buffer = Buffer.from(str, 'binary');
    const decoded = iconv.decode(buffer, encoding);
    return decoded;
  } catch (e) {
    return str; // Якщо не вдалося декодувати, повертаємо оригінальний рядок
  }
};

// Перетворення числових ключів на рядкові
const convertNumericKeysToStrings = (obj) => {
  const newObj = {};
  Object.keys(obj).forEach(key => {
    const stringKey = isNaN(key) ? key : String(key); // Перетворюємо ключ на рядок, якщо він числовий
    newObj[stringKey] = obj[key];
  });
  return newObj;
};

export default function App() {
  const [table, setTable] = useState([]);
  const [loader, setLoader] = useState(false);
  const [error, setError] = useState(null);
  const [tableValid, setTableValid] = useState(false);
  const [selectedEncoding, setSelectedEncoding] = useState('');
  const [decodedData, setDecodedData] = useState([]);
  const [columnOrder, setColumnOrder] = useState([]); // Збереження порядку колонок
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (selectedEncoding === '0') {
      setDecodedData(table); // Використовуємо оригінальну таблицю без декодування
      return;
    }

    const decodeObject = (obj) => {
      const decodedObj = {};
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          decodedObj[key] = decodeString(obj[key], selectedEncoding);
        } else {
          decodedObj[key] = obj[key];
        }
      }
      return decodedObj;
    };

    const decoded = table.map(item => decodeObject(item));
    setDecodedData(decoded);
    setTableValid(true);
  }, [selectedEncoding, table]);

  const openFileInput = () => {
    fileInputRef.current.click();
  };

  const importFile = async (e) => {
    setLoader(true);
    const file = e.target.files[0];
    try {
      const data = await file.arrayBuffer();
      const wb = read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = utils.sheet_to_json(ws, { defval: "" });

      // Перетворюємо всі числові ключі на рядкові
      const convertedData = jsonData.map(item => convertNumericKeysToStrings(item));
      setTable(convertedData);

      // Зберігаємо порядок колонок без сортування
      const firstRowKeys = Object.keys(convertedData[0]);
      setColumnOrder(firstRowKeys); // Зберігаємо порядок колонок у масиві

      setLoader(false);
      setError(null);
    } catch (error) {
      setLoader(false);
      setError(`Помилка читання файла: ${error.message}`);
    }
  };

  const resetForm = () => {
    setTable([]);
    setDecodedData([]);
    setSelectedEncoding('');
    setTableValid(false);
    setColumnOrder([]); // Очищаємо порядок колонок
    setError(null);
  };

  const exportFile = async () => {
    try {
      // Формуємо дані у відповідності до збереженого порядку колонок
      const orderedData = decodedData.map(item => {
        const orderedItem = {};
        columnOrder.forEach((key) => {
          orderedItem[key] = item[key] !== undefined ? item[key] : ''; // Слідкуємо за тим, щоб не втратити порожні значення
        });
        return orderedItem;
      });

      const ws = utils.json_to_sheet(orderedData, { defval: "" }); // Включаємо порожні колонки
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Data");
      let d = new Date().getTime();
      await writeFileXLSX(wb, `${d}.xlsx`);
      
      // Повертаємо форму в початковий стан після експорту
      resetForm();
    } catch (error) {
      setError(`Помилка експорту: ${error.message}`);
    }
  };

  return (
    <div className={style.container}>
      <div className={style.card}>
        <h2>Table Converter</h2>
        <input 
          type="file" 
          className={style.btn} 
          style={{ display: 'none' }}
          ref={fileInputRef}
          onChange={importFile}
          disabled={loader}  // Вимикаємо кнопку під час завантаження
        />
        <button 
          className={style.btn} 
          onClick={openFileInput}
          disabled={loader}  // Вимикаємо кнопку під час завантаження
        >
          вибрати
        </button>
        
        <select 
          className={style.btn}
          value={selectedEncoding} 
          onChange={(e) => setSelectedEncoding(e.target.value)}
          disabled={loader}  // Вимикаємо кнопку під час завантаження
        >
          <option value="" disabled>виберіть кодування</option>
          <option value="utf-8">UTF-8</option>
          <option value="utf-7">UTF-7</option>
          <option value="windows-1251">Windows-1251</option>
          <option value="windows-1252">Windows-1252</option>
          <option value="windows-1256">Windows-1256</option>
          <option value="koi8-r">KOI8-R</option>
          <option value="iso-8859-1">ISO-8859-1</option>
          <option value="cp866">cp866</option>
          <option value="cp1251">cp1251</option>
          <option value="cp1252">cp1252</option>
          <option value="ibm866">ibm866</option>
          <option value="0">залишити без змін</option>
        </select>

        <button 
          className={style.btn}
          disabled={!tableValid || selectedEncoding === '' || loader}  // Вимикаємо кнопку, якщо умови не дотримані або завантаження
          onClick={exportFile}
        >
          Експорт XLSX
        </button>
        {error && <div>{error}</div>}
        {loader && <p className={style.firstLine_loading}>loading...</p>}
        {decodedData.length > 0 && 
          <div className={style.firstLine}>
            <h2 className={style.firstLine_title}>First line</h2>
            {columnOrder.map((key) => (  // Відображаємо колонки в збереженому порядку
              <p className={style.firstLine_item} key={key}>
                {`${key}: ${decodedData[0][key] !== '' ? decodedData[0][key] : 'немає даних'}`}
              </p>
            ))}
          </div>}
      </div>
    </div>
  );
}
