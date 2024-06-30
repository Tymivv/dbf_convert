import React, {useState, useRef } from "react";
import { read, utils, writeFileXLSX } from 'xlsx';
import { decodeString } from './utils';
import style from './app.module.css';
window.Buffer = window.Buffer || require("buffer").Buffer;

export default function App() {
  const [table, setTable] = useState([]);
  const [loader, setLoader] = useState(false);
  const [error, setError] = useState(null);
  const [tableValid, setTableValid] = useState(false);
  const fileInputRef = useRef(null);

  const decodeObject = (obj) => {
    const decodedObj = {};
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        decodedObj[key] = decodeString(obj[key]);
      } else {
        decodedObj[key] = obj[key];
      }
    }
    return decodedObj;
  };

  const handleFixEncoding = () => {
    const decoded = table.map(item => decodeObject(item));
    setTable(decoded);
  };

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
        setTableValid(true); 
    } catch (error) {
        setError('Помилка читання файла', error);
      }
    }
  ;

  const exportFile = async () => {
    const ws = utils.json_to_sheet(table);
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
                select table
            </button>
            <button 
                className={style.btn}
                onClick={handleFixEncoding}>
                change encoding
            </button>
            <button 
                className={style.btn}
                disabled={!tableValid} 
                onClick={exportFile}>
                Export XLSX
            </button>
          {error && <div>{error}</div>}
          {loader && <p className={style.firstLine_loading}>loading...</p>}
          {table.length>0 && 
              <div 
              className={style.firstLine}>
                  <h2 className={style.firstLine_title}>First line</h2>
                  {Object.entries(table[0]).map(([key, value]) => (
                  <p className={style.firstLine_item}key={key}>{`${key}: ${value}`}</p>
                  ))}
              </div>}
          </div>
    </div>);
}
