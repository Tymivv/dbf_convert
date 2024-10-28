
import React, { useState, useRef, useEffect } from "react";
import * as XLSX from 'xlsx'; // Імпорт XLSX
import { read, utils, writeFileXLSX } from 'xlsx'; // Імпорт функцій з xlsx
import * as cptable from 'codepage'; // Імпорт таблиць кодувань
import iconv from 'iconv-lite';
import style from './app.module.css';
import { Buffer } from 'buffer';
window.Buffer = window.Buffer || require("buffer").Buffer;

// XLSX.set_cptable(cptable); // Завантаження таблиці кодувань

const decodeString = (str, encoding) => {
  try {
    const buffer = Buffer.from(str, 'binary');
    const decoded = iconv.decode(buffer, encoding);
    console.log(decoded);
    return decoded;
  } catch (e) {
    return str;
  }
};

// Перетворення числових ключів на рядкові
const convertNumericKeysToStrings = (obj) => {
  const newObj = {};
  Object.keys(obj).forEach(key => {
    const stringKey = isNaN(key) ? key : String(key);
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
  const [columnOrder, setColumnOrder] = useState([]);
  const [useCptable, setUseCptable] = useState(false); // Стан для вибору cptable

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (selectedEncoding === '0') {
      setDecodedData(table);
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
       // Якщо користувач обрав cptable, встановлюємо кодування
      if (useCptable) {
        XLSX.set_cptable(cptable);
      }
      // Виконуємо зчитування файлу
      const wb = read(data, { type: 'array', raw: true, codepage: useCptable ? 866 : undefined });
      console.log(wb);
      const ws = wb.Sheets[wb.SheetNames[0]];
      console.log(ws);
      const jsonData = utils.sheet_to_json(ws, { defval: "" });

      // обробка даних для обробки полів дати
      const processedData = jsonData.map(item => {
        const newItem = {};
        for (const key in item) {
          if (item[key] instanceof Date) {
              if (item[key].getTime() === -2211760924000) {
              newItem[key] = null;
            } else {
              newItem[key] = item[key];
            }
          } else if (typeof item[key] === 'string' && item[key] === '') {
            newItem[key] = null;
          } else {
            newItem[key] = item[key];
          }
        }
        return convertNumericKeysToStrings(newItem);
      });
      setTable(processedData);

      // Зберігаємо порядок колонок без сортування
      const firstRowKeys = Object.keys(processedData[0]);
      setColumnOrder(firstRowKeys);
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
    setColumnOrder([]);
    setError(null);
  };

  const exportFile = async (type) => {
    try {
      // Формуємо дані у відповідності до збереженого порядку колонок
      const orderedData = decodedData.map(item => {
        const orderedItem = {};
        columnOrder.forEach((key) => {
          if (item[key] instanceof Date) {
            if (isNaN(item[key].getTime())) {
              orderedItem[key] = ''; // порожня дата
            } else {
              // Форматувати дату як «дд.мм.рррр»  
              let d = item[key];
              let day = String(d.getDate()).padStart(2, '0');
              let month = String(d.getMonth() + 1).padStart(2, '0');
              let year = d.getFullYear();
              orderedItem[key] = `${day}.${month}.${year}`;
            }
          } else {
            orderedItem[key] = item[key] !== undefined ? item[key] : '';
          }
        });
        return orderedItem;
      });

      // Видалити опцію cellDates, щоб запобігти неправильному тлумаченню рядків дат
      const ws = utils.json_to_sheet(orderedData, { defval: '' });
      if (type === 'xlsx') {
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, "Data");
        let d = new Date().getTime();
        await writeFileXLSX(wb, `${d}.xlsx`);
      } else if (type === 'csv') {
        const csv = utils.sheet_to_csv(ws);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      // Повертаємо форму в початковий стан після експорту
      resetForm();
    } catch (error) {
      setError(`Помилка експорту: ${error.message}`);
    }
  };
  const handleCptableChange = (e) => {
    setUseCptable(e.target.checked);
  };
  return (
    <div className={style.container}>
      <div className={style.card}>
        <h1>Table Converter</h1>
        <div className={style.codingChec}>
          <input type="checkbox" checked={useCptable} onChange={handleCptableChange} />
          <span>підібрати кодування</span>
        </div>
        <input 
          type="file" 
          className={style.btn} 
          style={{ display: 'none' }}
          ref={fileInputRef}
          onChange={importFile}
          disabled={loader}
        />
        <button 
          className={style.btn} 
          onClick={openFileInput}
          disabled={loader}
        >
          вибрати
        </button>
        
        <select 
          className={style.btn}
          value={selectedEncoding} 
          onChange={(e) => setSelectedEncoding(e.target.value)}
          disabled={loader}
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
          disabled={!tableValid || selectedEncoding === '' || loader}
          onClick={() => exportFile('xlsx')}
        >
          Експорт XLSX
        </button>

        <button 
          className={style.btn}
          disabled={!tableValid || selectedEncoding === '' || loader}
          onClick={() => exportFile('csv')}
        >
          Експорт CSV
        </button>

        {error && <div>{error}</div>}
        {loader && <p className={style.firstLine_loading}>loading...</p>}
        {decodedData.length > 0 && 
          <div className={style.firstLine}>
            <h2 className={style.firstLine_title}>First line</h2>
            {columnOrder.map((key) => (
              <p className={style.firstLine_item} key={key}>
                {`${key}: ${decodedData[0][key] !== '' ? decodedData[0][key] : 'немає даних'}`}
              </p>
            ))}
          </div>}
      </div>
    </div>
  );
}
