import React, {useState, useRef, useEffect } from "react";
import { read, utils, writeFileXLSX } from 'xlsx';
import { decodeString } from './utils';
import style from './app.module.css';
window.Buffer = window.Buffer || require("buffer").Buffer;

export default function App() {
  const [table, setTable] = useState([]);
  const [table0, setTable0] = useState([]);
  const [loader, setLoader] = useState(false);
  const [error, setError] = useState(null);
  const [tableValid, setTableValid] = useState(false);
  const [selectedEncoding, setSelectedEncoding] = useState('');
  const [decodedData, setDecodedData] = useState([]);
  const fileInputRef = useRef(null);


  useEffect(() => {
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

  }, [selectedEncoding]);

  const openFileInput = () => {
    fileInputRef.current.click();
  };

  const importFile = 
    async(e) => {
      setLoader(true);
      const file = e.target.files[0];
      try {
        const data = await file.arrayBuffer();
        const wb = read(data);
        const ws= wb.Sheets[wb.SheetNames[0]];
        setTable(utils.sheet_to_json(ws));
        setLoader(false);
        setTable0(0);
        console.log(table0);
    } catch (error) {
        setError('Помилка читання файла', error);
      }
    }
  ;

  const exportFile = async () => {
    const ws = utils.json_to_sheet(decodedData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Data");
    let d = new Date().getTime()
    await writeFileXLSX(wb, `${d}.xlsx`);
    setTableValid(false);
    setTable([])  
  };


  return (
    <div className={style.container}>
        <div className={style.card}>
            <input 
                type="file" 
                className={style.btn} 
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={importFile}/>
            <button 
                className={style.btn} 
                onClick={openFileInput}>
                вибрати
            </button>
            
        <select 
        className={style.btn}
          value={selectedEncoding} 
          onChange={(e) => setSelectedEncoding(e.target.value)}
        >
          <option value="" disabled  >виберіть кодування</option>
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
                disabled={!tableValid && selectedEncoding==='' } 
                onClick={exportFile}>
                Експорт XLSX
            </button>
          {error && <div>{error}</div>}
          {/* {table.length>0 && <p className={style.firstLine_loading}>таблиця завантажина</p>}   */}
          {loader && <p className={style.firstLine_loading}>loading...</p>}       
          {decodedData.length>0 && 
              <div 
              className={style.firstLine}>
                  <h2 className={style.firstLine_title}>First line</h2>
                  {Object.entries(decodedData[0]).map(([key, value]) => (
                  <p className={style.firstLine_item}key={key}>{`${key}: ${value}`}</p>
                  ))}
              </div>}
          </div>
    </div>);
}
