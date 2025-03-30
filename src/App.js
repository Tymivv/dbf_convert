import React, { useState, useRef, useEffect} from "react";
import * as XLSX from "xlsx";
import Modal from 'react-modal';
import { read, utils, writeFileXLSX } from "xlsx";
import iconv from "iconv-lite";
import pako from "pako";

import { Buffer } from "buffer";
import { saveAs } from "file-saver";
import GoogleSheetUploader from "./GoogleSheetUploader/GoogleSheetUploader";
import GoogleSheetImporter  from "./GoogleSheetImporter/GoogleSheetImporter";


import style from "./app.module.css";

// Запобігаємо проблемам із Buffer у браузері
window.Buffer = window.Buffer || require("buffer").Buffer;

// ----------------------------------------------------------------------------
// Допоміжні функції (декодування, перевірка дат, чисел тощо)
// ----------------------------------------------------------------------------
const convertNumericKeysToStrings = (obj) => {
  const newObj = {};
  Object.keys(obj).forEach((key) => {
    const stringKey = isNaN(key) ? key : String(key);
    newObj[stringKey] = obj[key];
  });
  return newObj;
};

const makeUniqueColumnNames2 = (fields) => {
  const nameCount = {};

  return fields.map((field) => {
    const originalName = field.name;

    if (nameCount[originalName]) {
      const uniqueName = `${originalName}_${nameCount[originalName]}`;
      nameCount[originalName] += 1;
      return { ...field, name: uniqueName };
    } else {
      nameCount[originalName] = 1;
      return field; // Якщо ім'я унікальне, повертаємо поле без змін
    }
  });
};

// const makeUniqueColumnNames = (columns) => {
//   const nameCount = {};
//   return columns.map((col) => {
//     if (nameCount[col]) {
//       const uniqueName = `${col}_${nameCount[col]}`;
//       nameCount[col] += 1;
//       return uniqueName;
//     } else {
//       nameCount[col] = 1;
//       return col;
//     }
//   });
// };

const decodeString = (str, encoding) => {
  try {
    const buffer = Buffer.from(str, "binary");
    const decoded = iconv.decode(buffer, encoding);
    return decoded;
  } catch (e) {
    return str;
  }
};

const isDate = (value) => {
  if (typeof value !== "string") return false;
  const dateFormats = [
    /^\d{2}\.\d{2}\.\d{4}$/, // DD.MM.YYYY
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // M/D/YY or MM/DD/YYYY
  ];
  return dateFormats.some((regex) => regex.test(value));
};

const isNumeric = (value) => {
  if (value === null || value === undefined) return false;
  const normalizedValue = value.toString().replace(",", ".");
  return !isNaN(parseFloat(normalizedValue)) && isFinite(normalizedValue);
};

const getNumberSizeAndDecimal = (value) => {
  const normalizedValue = value.toString().replace(",", ".");
  const numValue = parseFloat(normalizedValue);
  if (isNaN(numValue)) {
    return { size: 10, decimal: 0 };
  }
  const decimalDigits = (normalizedValue.split(".")[1] || "").length;
  const formattedValue = numValue.toFixed(decimalDigits);
  const size = formattedValue.replace(".", "").length + (decimalDigits > 0 ? 1 : 0);
  return { size: size > 20 ? 20 : size, decimal: decimalDigits };
};

const formatDateForDbf = (value) => {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const year = value.getFullYear().toString();
    const month = ("0" + (value.getMonth() + 1)).slice(-2);
    const day = ("0" + value.getDate()).slice(-2);
    return `${year}${month}${day}`;
  }
  // Якщо рядок
  let dateObj;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
    const [day, month, year] = value.split(".");
    dateObj = new Date(`${year}-${month}-${day}`);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value)) {
    const [m, d, y] = value.split("/");
    const fullYear = y.length === 2 ? `20${y}` : y;
    dateObj = new Date(`${fullYear}-${m}-${d}`);
  } else {
    return "00000000";
  }
  if (isNaN(dateObj.getTime())) {
    return "00000000";
  }
  const year = dateObj.getFullYear().toString();
  const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
  const day = ("0" + dateObj.getDate()).slice(-2);
  return `${year}${month}${day}`;
};

// ----------------------------------------------------------------------------
// Парсинг DBF (читаємо заголовок, поля і записи)
// ----------------------------------------------------------------------------

function parseDbfFile(arrayBuffer, codePage = "cp866") {

  if (arrayBuffer.byteLength < 32) {
    throw new Error("Файл DBF занадто короткий або порожній");
  }
  const view = new DataView(arrayBuffer);

  let recordCount = view.getUint32(4, true);
  const headerSize = view.getUint16(8, true);
  let recordSize = view.getUint16(10, true);

  const dataSectionSize = arrayBuffer.byteLength - headerSize;

  // Розрахунок кількості записів, якщо header невірний
  //   if (recordCount === 0 || recordSize <= 0 || recordSize > arrayBuffer.byteLength) {
  //     recordCount = Math.floor(dataSectionSize / recordSize) || 1;
  //     recordSize = Math.floor(dataSectionSize / Math.max(recordCount, 1));
  // }

// ------

// 1. Якщо recordSize <= 0 або занадто великий, некоректний
if (recordSize <= 0 || recordSize > arrayBuffer.byteLength) {
  throw new Error("Пошкоджений DBF");
}

// 2. Якщо (recordCount === 0) і dataSectionSize > 0, 
//    в заголовку recordCount некоректний 

if (recordCount === 0 && dataSectionSize >= recordSize) {
  // битий заголовок, рахуємо:
  const possibleRecords = Math.floor(dataSectionSize / recordSize);
  if (possibleRecords > 0) {
    console.warn(
      `У заголовку зазначено recordCount=0, але розділ даних може вмістити ${possibleRecords} записів.`
    );
    recordCount = possibleRecords;
  }
}

// 3. Перевірка, чи достатньо місця для оголошеної кількості записів
//    Якщо recordCount > 0, але dataSectionSize < recordCount*recordSize – теж проблема
const neededBytes = recordCount * recordSize;
if (neededBytes > dataSectionSize) {
  const maxFit = Math.floor(dataSectionSize / recordSize);
  console.warn(
    `У заголовку recordCount=${recordCount}, а реально можна вмістити лише ${maxFit} записів. Зменшуємо recordCount`
  );
  recordCount = maxFit;
}

// ------

  let offset = 32;
  const fields = [];

  // Читаємо поля
  while (true) {
    if (view.getUint8(offset) === 0x0d) {
      break;
    }
    const nameBytes = [];
    for (let i = 0; i < 10; i++) {
      const b = view.getUint8(offset + i);
      if (b !== 0) {
        nameBytes.push(b);
      }
    }
    const fieldName = iconv
      .decode(Buffer.from(nameBytes), "ascii")
      .replace(/\0+$/, "");

    const fieldType = String.fromCharCode(view.getUint8(offset + 11));
    const fieldLength = view.getUint8(offset + 16);
    const fieldDecimal = view.getUint8(offset + 17);

    fields.push({
      name: fieldName,
      type: fieldType,
      size: fieldLength,
      decimal: fieldDecimal,
    });

    offset += 32;
  }
  // const uniqueFields = makeUniqueColumnNames(fields.map((f) => f.name));
const uniqueFields = makeUniqueColumnNames2(fields);
  let recordsOffset = headerSize;
  const rows = [];

  // Читаємо дані

  if (recordCount > 0 & recordsOffset + recordSize <= arrayBuffer.byteLength) {
    // Використовуємо цикл for, якщо recordCount коректний
    for (let r = 0; r < recordCount; r++) {
      const deletedFlag = view.getUint8(recordsOffset);
      if (deletedFlag === 0x2a) {
        // Пропускаємо "видалений" запис
        recordsOffset += recordSize;
        continue;
      }
      let recDataOffset = recordsOffset + 1;
      const rowObj = {};
  
      fields.forEach((field, index) => {
        const rawBytes = new Uint8Array(arrayBuffer, recDataOffset, field.size);
        recDataOffset += field.size;
  
        const decoder = new TextDecoder(codePage);
        const rawText = decoder.decode(rawBytes).trim();
        // Опрацювання даних залежно від типу поля
        if (field.type === "N") {
          if (rawText === "") {
            rowObj[uniqueFields[index].name] = null;
          } else {
            const val = parseFloat(rawText);
            rowObj[uniqueFields[index].name] = isNaN(val) ? rawText : val;
          }
        } else if (field.type === "D") {
          if (rawText === "        ") {
            rowObj[uniqueFields[index].name] = "";
          } else if (rawText === "00000000") {
            rowObj[uniqueFields[index].name] = "";
          } else if (rawText.length === 8) {
            const yyyy = rawText.substring(0, 4);
            const mm = rawText.substring(4, 6);
            const dd = rawText.substring(6, 8);
            rowObj[uniqueFields[index].name] = `${dd}.${mm}.${yyyy}`;
          } else {
            rowObj[uniqueFields[index].name] = rawText;
          }
        } else {
          rowObj[uniqueFields[index].name] = rawText;
        }
      });
  
      rows.push(rowObj);
      recordsOffset += recordSize;
    }
  } else {
    // Використовуємо цикл while, якщо recordCount некоректний
    while (recordsOffset + recordSize <= arrayBuffer.byteLength) {
      const deletedFlag = view.getUint8(recordsOffset);
      if (deletedFlag === 0x2a) {
        // Пропускаємо "видалений" запис
        recordsOffset += recordSize;
        continue;
      }
      let recDataOffset = recordsOffset + 1;
      const rowObj = {};

      fields.forEach((field, index) => {
        const rawBytes = new Uint8Array(arrayBuffer, recDataOffset, field.size);
        recDataOffset += field.size;
  
        const decoder = new TextDecoder(codePage);
        const rawText = decoder.decode(rawBytes).trim();
        // Опрацювання даних залежно від типу поля
        if (field.type === "N") {
          if (rawText === "") {
            rowObj[uniqueFields[index].name] = null;
          } else {
            const val = parseFloat(rawText);
            rowObj[uniqueFields[index].name] = isNaN(val) ? rawText : val;
          }
        } else if (field.type === "D") {
          if (rawText === "        ") {
            rowObj[uniqueFields[index].name] = "";
          } else if (rawText === "00000000") {
            rowObj[uniqueFields[index].name] = "";
          } else if (rawText.length === 8) {
            const yyyy = rawText.substring(0, 4);
            const mm = rawText.substring(4, 6);
            const dd = rawText.substring(6, 8);
            rowObj[uniqueFields[index].name] = `${dd}.${mm}.${yyyy}`;
          } else {
            rowObj[uniqueFields[index].name] = rawText;
          }
        } else {
          rowObj[uniqueFields[index].name] = rawText;
        }
      });
  
      rows.push(rowObj);
      recordsOffset += recordSize;    }
  }
  return { fields: uniqueFields, rows };
}


// ----------------------------------------------------------------------------
// Формування DBF (для експорту)
// ----------------------------------------------------------------------------
const createDbfHeader = (fields, numRecords, encoding) => {
  const now = new Date();
  const header = new ArrayBuffer(32 + fields.length * 32 + 1);
  const view = new DataView(header);

  view.setUint8(0, 0x03);
  view.setUint8(1, now.getFullYear() - 1900);
  view.setUint8(2, now.getMonth() + 1);
  view.setUint8(3, now.getDate());
  view.setUint32(4, numRecords, true);
  view.setUint16(8, 32 + fields.length * 32 + 1, true);

  const recordLength = fields.reduce((sum, f) => sum + f.size, 1);
  view.setUint16(10, recordLength, true);

  fields.forEach((field, index) => {
    const name = field.name.substring(0, 10).padEnd(10, "\0");
    const encodedName = iconv.encode(name, encoding);
    for (let i = 0; i < 10; i++) {
      view.setUint8(32 + index * 32 + i, encodedName[i] || 0);
    }
    view.setUint8(32 + index * 32 + 11, field.type.charCodeAt(0));
    view.setUint8(32 + index * 32 + 16, field.size);
    if (field.type === "N") {
      view.setUint8(32 + index * 32 + 17, field.decimal || 0);
    }
  });
  view.setUint8(32 + fields.length * 32, 0x0d);
  return header;
};

const createDbfRecord = (fields, record, encoding) => {
  const recordBuffer = new ArrayBuffer(
    fields.reduce((sum, f) => sum + f.size, 1)
  );
  const view = new DataView(recordBuffer);

  view.setUint8(0, 0x20);

  let offset = 1;
  fields.forEach((field) => {
    let value = record[field.name] || "";
    switch (field.type) {
      case "C": {
        const strVal = value.toString().padEnd(field.size, " ");
        const encodedValue = iconv.encode(strVal, encoding);
        for (let i = 0; i < field.size; i++) {
          view.setUint8(offset + i, encodedValue[i] || 0x20);
        }
        break;
      }
      case "N": {
        const numVal = parseFloat(value.toString().replace(",", "."));
        const fixedVal = isNaN(numVal)
          ? "".padStart(field.size, " ")
          : numVal.toFixed(field.decimal || 0).padStart(field.size, " ");
        for (let i = 0; i < field.size; i++) {
          view.setUint8(offset + i, fixedVal.charCodeAt(i) || 0x20);
        }
        break;
      }
      case "D": {
        // Якщо value порожнє:
        if (!value) {
          for (let i = 0; i < 8; i++) {
            view.setUint8(offset + i, 0x20); // ASCII 32 = ' '
          }
        } else {
          // Якщо value не пусте, форматуємо дату, наприклад, "20231005" (YYYYMMDD)
          const rawVal = formatDateForDbf(value); 
          for (let i = 0; i < 8; i++) {
            view.setUint8(offset + i, rawVal.charCodeAt(i) || 0x30);
          }
        }
        break;
      }
      // case "D": {
      //   const rawVal = formatDateForDbf(value);
      //   for (let i = 0; i < 8; i++) {
      //     view.setUint8(offset + i, rawVal.charCodeAt(i) || 0x30);
      //   }
      //   break;
      // }
      case "L": {
        const upperVal = value.toString().trim().toUpperCase();
        const logicalValue =
          upperVal === "TRUE" || upperVal === "T" || upperVal === "1"
            ? "T"
            : "F";
        view.setUint8(offset, logicalValue.charCodeAt(0));
        break;
      }
      default:
        break;
    }
    offset += field.size;
  });

  return recordBuffer;
};


// ----------------------------------------------------------------------------
//  стиснути дані за допомогою бібліотеку pako, яка дозволяє стискати й розпаковувати дані за допомогою алгоритму GZIP.
// ----------------------------------------------------------------------------
const compressData = (data) => {
  const compressed = pako.gzip(new Uint8Array(data)); // Стиснення у формат Uint8Array
  return compressed.buffer; // Повертаємо ArrayBuffer
};

const decompressData = (compressedData) => {
  const decompressed = pako.ungzip(new Uint8Array(compressedData)); // Декомпресія
  return decompressed.buffer; // Повертаємо ArrayBuffer
};
// const compressData = (data) => {
//   const stringifiedData = JSON.stringify(data); // Перетворення у рядок
//   const compressed = pako.gzip(stringifiedData); // Стиснення
//   return compressed;
// };
// const decompressData = (compressedData) => {
//   const decompressed = pako.ungzip(compressedData, { to: "string" }); // Розпакування
//   return JSON.parse(decompressed); // Перетворення назад у об'єкт
// };

// console.log(`Original data size: ${(JSON.stringify(rows).length / (1024 * 1024)).toFixed(2)} MB`);
// const compressedData = compressData(rows);
// console.log(`Compressed data size: ${(compressedData.byteLength / (1024 * 1024)).toFixed(2)} MB`);
// const displayData = decompressData(compressedData);
// console.log("Decompressed data", displayData);

// ----------------------------------------------------------------------------
// Основний компонент
// ----------------------------------------------------------------------------
export default function App() {

  const [fileBuffer, setFileBuffer] = useState(null);     // оригінальні байти
  const [fileExtension, setFileExtension] = useState(""); // "dbf", "xlsx", "csv", ...

  // --------------------- ОСНОВНІ СТАНИ ---------------------
  const [decodedData, setDecodedData] = useState([]); 
  const [columnOrder, setColumnOrder] = useState([]);
  const [tableValid, setTableValid] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  const [selectedEncoding, setSelectedEncoding] = useState("windows-1251"); //---випадаючий список кодувань
  const [uploadedFileName, setUploadedFileName] = useState(""); //---назва імпортованого файла
  const [loader, setLoader] = useState(false);
  const [error, setError] = useState(null);

  // --------------------- ПАГІНАЦІЯ ---------------------
  const [rowsPerPage, setRowsPerPage] = useState(10); 
  const [currentPage, setCurrentPage] = useState(0);  

  // --------------------- СОРТУВАННЯ--------------------
  const [sortColumn, setSortColumn] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");

  // -------------------- ФІЛЬТР------------------------
  // pendingFilters – те, що користувач набирає перед натисканням кнопки
  const [pendingFilters, setPendingFilters] = useState({});
  // activeFilters – те, що вже застосовано (натиснута кнопка "Filter")
  const [activeFilters, setActiveFilters] = useState({});

    // ---- ДОДАНО для модального вікна (видалення колонок) ----
    const [showColumnModal, setShowColumnModal] = useState(false);

  // Підрахунок сторінок
  // const totalPages = Math.ceil(decodedData.length / rowsPerPage);
  // const startIndex = currentPage * rowsPerPage;
  // const endIndex = startIndex + rowsPerPage;
  // const currentRows = decodedData.slice(startIndex, endIndex);


  // const goToFirstPage = () => setCurrentPage(0);
  // const goToPreviousPage = () =>
  //   setCurrentPage((prev) => (prev > 0 ? prev - 1 : 0));
  // const goToNextPage = () =>
  //   setCurrentPage((prev) => (prev < totalPages - 1 ? prev + 1 : prev));
  // const goToLastPage = () => setCurrentPage(totalPages - 1);

  // Якщо змінюємо кількість рядків, повертаємось на першу сторінку
  useEffect(() => {
    setCurrentPage(0);
  }, [rowsPerPage]);

 // ------------------- DBF поля -------------------
  // поля, які підбираємо автодетектом / ручними змінами
  const [fieldsConfig, setFieldsConfig] = useState([]);
  // поля, які прийшли з імпортованого DBF
  const [fieldsConfigFromDBF, setFieldsConfigFromDBF] = useState([]);
  // прапорець «Використати поля з DBF»
  const [useDbfFieldsFromImported, setUseDbfFieldsFromImported] = useState(false);
  // прапорець «Автовизначення типів»
  const [autoDetectTypes, setAutoDetectTypes] = useState(false);
  // кодування, яким збережемо DBF
  const [dbfEncoding, setDbfEncoding] = useState("windows-1251");
  // панель «Експорт в DBF» показувати/ховати
  const [showDbfExport, setShowDbfExport] = useState(false);

  const fileInputRef = useRef(null);

  //  Масив, який будемо показувати користувачу у блоці DBF
  // якщо useDbfFieldsFromImported – це fieldsConfigFromDBF
  // інакше – fieldsConfig
  const displayFields = useDbfFieldsFromImported ? fieldsConfigFromDBF : fieldsConfig;
  
  const parseFile = (buffer, ext, encoding) => {

    // Якщо DBF
    if (ext === "dbf") {
      const { fields, rows } = parseDbfFile(buffer, encoding);
      setFieldsConfigFromDBF(fields);
      const colNames = fields.map((f) => f.name);

      setColumnOrder(colNames);
      setDecodedData(rows);
      setTableValid(true);
      setCurrentPage(0);
          // Очищуємо локальну змінну rows
    } else if (ext === "csv") {
      try {
        const decoder = new TextDecoder(encoding); 
        const text = decoder.decode(buffer);
        // const text = iconv.decode(new Uint8Array(buffer), encoding);
        // 2) Читаємо csv з рядка
        const wb = XLSX.read(text, {
          type: "string",
          raw: true,
          codepage: undefined,
        });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = utils.sheet_to_json(ws, { defval: "" });
        if (!jsonData || !jsonData.length) {
          setError("В обраному файлі табличні дані не знайдено");
          return;
        }
        // Обробляємо можливі дати
        const processedData = jsonData.map(item => {
          const newItem = {};
          for (let key in item) {
            if (item[key] instanceof Date) {
              if (item[key].getTime() === -2211760924000) {
                newItem[key] = null;
              } else {
                newItem[key] = item[key];
              }
            } else if (typeof item[key] === "string" && item[key] === "") {
              newItem[key] = null;
            } else {
              newItem[key] = item[key];
            }
          }
          return   (newItem);
        });

        const firstRowKeys = Object.keys(processedData[0]);
        setColumnOrder(firstRowKeys);
        setDecodedData(processedData);
        setTableValid(true);
        setCurrentPage(0);
      } catch (err) {
        setError(`Помилка імпорту: ${err.message}`);
      }
    
    }
    else {
      try {
        const wb = read(buffer, {
          type: "array",
          raw: true,
          codepage: undefined,
        });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = utils.sheet_to_json(ws, { defval: "" });
        if (!jsonData || !jsonData.length) {
          setError("В обраному файлі табличні дані не знайдено");
          return;
        }
        // Обробляємо можливі дати
        const processedData = jsonData.map(item => {
          const newItem = {};
          for (let key in item) {
            if (item[key] instanceof Date) {
              if (item[key].getTime() === -2211760924000) {
                newItem[key] = null;
              } else {
                newItem[key] = item[key];
              }
            } else if (typeof item[key] === "string" && item[key] === "") {
              newItem[key] = null;
            } else {
              newItem[key] = item[key];
            }
          }
          return convertNumericKeysToStrings(newItem);
        });

        const firstRowKeys = Object.keys(processedData[0]);
        setColumnOrder(firstRowKeys);
        setDecodedData(processedData);
        setTableValid(true);
        setCurrentPage(0);
      } catch (err) {
        setError(`Помилка імпорту: ${err.message}`);
      }
    }
  };

  // -------------------------------------------------------
  // Імпорт XLSX, CSV, DBF
  // -------------------------------------------------------
  const openFileInput = () => {
    fileInputRef.current.click();
  };
  const closeModalExportModal = () => {
    setShowDbfExport(false);

  };
    // Коли користувач обирає файл
  // -------------------------------------------
  const handleFileImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileBuffer(null)
    setLoader(true);
    setUploadedFileName(file.name);
    setError(null);
    const ext = file.name.split(".").pop().toLowerCase();

    setFileExtension(ext);
    try {
      const arrayBuffer = await file.arrayBuffer(); // Отримуємо ArrayBuffer
      const compressedData = compressData(arrayBuffer); // Стискаємо дані
      setFileBuffer(compressedData); // Зберігаємо стиснені дані
      // Зберігаємо оригінальний буфер і розширення
      // setFileBuffer(compressedData);
      // parseFile(data, ext, selectedEncoding || "cp866");
    } catch (err) {
      setError(`Помилка читання файла: ${err.message}`);
    }
    setLoader(false);
  };

  // -------------------------------------------
  // Якщо хочемо змінювати кодування після імпорту
  // -------------------------------------------
  useEffect(() => {
    if (!fileBuffer || !fileExtension) return;
    // Очищення попередніх даних
    setDecodedData([]);
    let displayData
    try {
      displayData = decompressData(fileBuffer); // Декомпресуємо дані
      parseFile(displayData, fileExtension, selectedEncoding); // Передаємо ArrayBuffer у parseFile
      displayData = compressData(displayData); // Стискаємо дані
    } catch (err) {
      setError(`Помилка читання/парсингу: ${err.message}`);
    }
  }, [selectedEncoding, fileBuffer, fileExtension]);

  // -------------------------------------------------------
  // Експорт XLSX / CSV
  // -------------------------------------------------------
  const exportFile = async (type) => {
    try {
      if (!decodedData.length) return;
      const orderedData = decodedData.map((item) => {
        const obj = {};
        columnOrder.forEach((c) => {
          obj[c] = item[c] ?? "";
        });
        return obj;
      });
      const ws = utils.json_to_sheet(orderedData, { defval: "" });
      const baseFileName =
        uploadedFileName.split(".").slice(0, -1).join(".") || "exported_file";

      if (type === "xlsx") {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        writeFileXLSX(wb, `${baseFileName}.xlsx`);
      } else if (type === "xls") {  
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        XLSX.writeFile(wb, `${baseFileName}.xls`, { bookType: "xls" });
      } else {
        const csv = XLSX.utils.sheet_to_csv(ws);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${baseFileName}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      setError(`Помилка експорту: ${err.message}`);
    }
  };

  // -------------------------------------------------------
  // Додавання / видалення / перейменування колонок
  // -------------------------------------------------------
  const addColumn = () => {
    const columnName = prompt("Введіть назву нової колонки:");
    if (!columnName) return;
    if (columnOrder.includes(columnName)) {
      alert(`Колонка "${columnName}" вже існує!`);
      return;
    }
    setColumnOrder((prev) => [...prev, columnName]);
    setDecodedData((prev) =>
      prev.map((row) => ({ ...row, [columnName]: "" }))
    );
  };

  const removeColumn = (colName) => {
    setColumnOrder((prev) => prev.filter((c) => c !== colName));
    setDecodedData((prev) =>
      prev.map((row) => {
        const newRow = { ...row };
        delete newRow[colName];
        return newRow;
      })
    );
  };


  const renameColumn = (oldName, newName) => {
    if (!newName.trim()) {
      alert("Назва колонки не може бути порожньою!");
      return;
    }
    if (oldName === newName) return;
    if (columnOrder.includes(newName)) {
      alert(`Колонка "${newName}" вже існує!`);
      return;
    }
    setColumnOrder((prev) =>
      prev.map((col) => (col === oldName ? newName : col))
    );
    setDecodedData((prev) =>
      prev.map((row) => {
        if (row.hasOwnProperty(oldName)) {
          const newRow = { ...row, [newName]: row[oldName] };
          delete newRow[oldName];
          return newRow;
        }
        return row;
      })
    );
  };
  

  // -------------------------------------------------------
  // Редагування / Додавання / Видалення рядків
  // -------------------------------------------------------
  const handleCellChange = (globalRowIndex, colName, newValue) => {
    setDecodedData((prev) => {
      const copy = [...prev];
      copy[globalRowIndex] = { ...copy[globalRowIndex], [colName]: newValue };
      return copy;
    });
  };

  const addNewRecord = () => {
    const newRow = {};
    columnOrder.forEach((c) => {
      newRow[c] = "";
    });
    setDecodedData((prev) => [...prev, newRow]);
  };

  const deleteRecord = (globalRowIndex) => {
    if (!window.confirm(`Ви дійсно хочете видалити запис №${globalRowIndex + 1}?`))
      return;
    setDecodedData((prev) => {
      const copy = [...prev];
      copy.splice(globalRowIndex, 1);
      return copy;
    });
  };

  // -------------------------------------------------------
  // Експорт у DBF (з використанням оригінальних полів з DBF або ні)
  // -------------------------------------------------------

  const toggleDbfExport = () => {
    if (!decodedData.length) {
      alert("Немає даних для експорту!");
      return;
    }
    setShowDbfExport((prev) => !prev);
    if (!showDbfExport) {
      // Якщо відкриваємо панель – ініціалізуємо fieldsConfig
      initFieldsConfig(decodedData);
    }
  };
// Коли showDbfExport або autoDetectTypes змінюються
useEffect(() =>  {
  if (showDbfExport && decodedData.length) {
    initFieldsConfig(decodedData);
  }
}, [showDbfExport, autoDetectTypes, decodedData]);
  const initFieldsConfig = (data) => {
    if (!data.length) return;
    const keys = Object.keys(data[0]);
    const newConfig = keys.map((k) => {
      const sampleValue = data[0][k] ?? "";
      if (autoDetectTypes) {
        if (isDate(sampleValue)) {
          return { name: k, type: "D", size: 8, decimal: 0 };
        } else if (isNumeric(sampleValue)) {
          const { size, decimal } = getNumberSizeAndDecimal(sampleValue);
          return { name: k, type: "N", size, decimal };
        } else {
          const length = sampleValue.toString().length;
          return {
            name: k,
            type: "C",
            size: length > 254 ? 254 : Math.max(1, length),
            decimal: 0,
          };
        }
      } else {
        return { name: k, type: "C", size: 20, decimal: 0 };
      }
    });
    setFieldsConfig(newConfig);
  };

   // Користувач змінює поля, які відображаються (displayFields)
   const handleDisplayFieldChange = (idx, field, value) => {
    // Якщо useDbfFieldsFromImported – змінюємо fieldsConfigFromDBF
    // інакше – fieldsConfig
    if (useDbfFieldsFromImported) {
      setFieldsConfigFromDBF((prev) => {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], [field]: value };
        // Якщо змінюємо тип, робимо size=8 для "D"
        if (field === "type") {
          if (value === "D") {
            copy[idx].size = 8;
            copy[idx].decimal = 0;
          } else if (value === "L") {
            copy[idx].size = 1;
            copy[idx].decimal = 0;
          } else if (value === "C") {
            if (copy[idx].size < 1) {
              copy[idx].size = 20;
            }
            copy[idx].decimal = 0;
          }
        }
        return copy;
      });
    } else {
      setFieldsConfig((prev) => {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], [field]: value };
        // Якщо змінюємо тип
        if (field === "type") {
          if (value === "D") {
            copy[idx].size = 8;
            copy[idx].decimal = 0;
          } else if (value === "L") {
            copy[idx].size = 1;
            copy[idx].decimal = 0;
          } else if (value === "C") {
            if (copy[idx].size < 1) {
              copy[idx].size = 20;
            }
            copy[idx].decimal = 0;
          }
        }
        return copy;
      });
    }
  };

  const convertToDBF = () => {
    if (!decodedData.length) return;
    try {
      let finalFields = useDbfFieldsFromImported ? fieldsConfigFromDBF : fieldsConfig;

      if (useDbfFieldsFromImported && fieldsConfigFromDBF?.length) {
        // Використовуємо оригінальні поля з імпортованого DBF
        finalFields = fieldsConfigFromDBF;
      } else {
        // Використовуємо авто/ручні поля
        fieldsConfig.forEach((f) => {
          f.size = parseInt(f.size, 10) || 1;
          if (f.type === "N") {
            f.decimal = parseInt(f.decimal, 10) || 0;
          } else {
            f.decimal = 0;
          }
        });
        finalFields = fieldsConfig;
      }

      const header = createDbfHeader(finalFields, decodedData.length, dbfEncoding);
      const records = decodedData.map((row) =>
        createDbfRecord(finalFields, row, dbfEncoding)
      );

      let totalLength = header.byteLength;
      records.forEach((r) => {
        totalLength += r.byteLength;
      });
      const dbfBuffer = new ArrayBuffer(totalLength + 1);
      const view = new DataView(dbfBuffer);
      new Uint8Array(dbfBuffer).set(new Uint8Array(header), 0);
      let offset = header.byteLength;
      for (let r of records) {
        new Uint8Array(dbfBuffer).set(new Uint8Array(r), offset);
        offset += r.byteLength;
      }
      view.setUint8(totalLength, 0x1a);

      if (dbfEncoding === "win-1251") {
        view.setUint8(29, 0xc9);
      } else if (dbfEncoding === "cp866") {
        view.setUint8(29, 0x65);
      }
      const baseFileName =
        uploadedFileName.split(".").slice(0, -1).join(".") || "exported_file";
      const blob = new Blob([dbfBuffer], { type: "application/octet-stream" });
      saveAs(blob, `${baseFileName}.dbf`);
    } catch (error) {
      console.error("Помилка конвертування в DBF:", error);
      alert(`Помилка конвертування в DBF: ${error.message}`);
    }
  };

  const initializeNewTable = () => {
    const columnCount = prompt("Введіть кількість колонок:", "3");
    if (!columnCount || isNaN(columnCount) || columnCount < 1 || columnCount > 10) {
      alert("Введіть коректну кількість колонок!");
      return;
    }
  
    const columns = [];
    for (let i = 0; i < columnCount; i++) {
      // const columnName = prompt(`Введіть назву колонки ${i + 1}:`, `column_${i + 1}`);
      // columns.push(columnName || `column_${i + 1}`);
      columns.push(`column_${i + 1}`);
    }
  
    setColumnOrder(columns); // Встановити порядок колонок
    setDecodedData([]); // Початкова таблиця порожня
    setTableValid(true); // Вмикає можливість роботи з таблицею
    setUploadedFileName("Нова таблиця");
  };
  

  // Callback, який отримує дані з GoogleSheetImporter
  // Тут importData – об'єкт { headers, rows }
  const handleDataImported = (importData) => {
    if (importData && importData.headers) {
      // Встановлюємо заголовки таблиці з headers
      setColumnOrder(importData.headers);
      // Дані – це rows (можуть бути порожні, якщо були лише заголовки)
      setDecodedData(importData.rows);
      setTableValid(true);
      setCurrentPage(0);
    } else {
      setDecodedData([]);
    }
  };




// -------------------------------------------------------------
  //               ФУНКЦІЯ СОРТУВАННЯ
  // -------------------------------------------------------------
  const handleSort = (colName, order) => {
    // Користувач натиснув стрілку вгору (asc) або вниз (desc)
    setSortColumn(colName);
    setSortOrder(order);
    // Повертаємось на першу сторінку, щоб відобразити початок відсортованих результатів
    setCurrentPage(0);
  };

  function getSortedData(rows) {
    if (!sortColumn) return rows;
  
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const valA = a[sortColumn];
      const valB = b[sortColumn];
  
      // Приводимо до рядка
      const strA = (valA ?? "").toString();
      const strB = (valB ?? "").toString();
  
      // 1) Чи вони дати формату DD.MM.YYYY?
      const dateRegex = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
      const matchA = strA.match(dateRegex);
      const matchB = strB.match(dateRegex);
  
      if (matchA && matchB) {
        // Якщо обидва - дати
        const dateObjA = new Date(
          `${matchA[3]}-${matchA[2].padStart(2, "0")}-${matchA[1].padStart(2, "0")}`
        );
        const dateObjB = new Date(
          `${matchB[3]}-${matchB[2].padStart(2, "0")}-${matchB[1].padStart(2, "0")}`
        );
        return sortOrder === "asc"
          ? dateObjA - dateObjB
          : dateObjB - dateObjA;
      } else if (matchA && !matchB) {
        // Одне поле - дата, інше - ні; вирішуйте, як порівнювати
        return sortOrder === "asc" ? -1 : 1;
      } else if (!matchA && matchB) {
        return sortOrder === "asc" ? 1 : -1;
      }
  
      // 2) Якщо не дати, пробуємо числа
      const numA = parseFloat(strA);
      const numB = parseFloat(strB);
      const bothNumeric = !isNaN(numA) && !isNaN(numB);
  
      if (bothNumeric) {
        // Сортуємо як числа
        return sortOrder === "asc" ? numA - numB : numB - numA;
      }
  
      // 3) Якщо ні дати, ні числа – сортуємо як рядки
      if (strA < strB) return sortOrder === "asc" ? -1 : 1;
      if (strA > strB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  
    return sorted;
  }

  // -------------------------------------------------------------
  //               ФУНКЦІЯ ФІЛЬТРУВАННЯ
  // -------------------------------------------------------------
  function getFilteredData(rows) {
    let filteredRows = [...rows];
    for (const col of Object.keys(activeFilters)) {
      const filterVal = activeFilters[col]?.trim();
      if (!filterVal) continue; // порожній фільтр
      
      filteredRows = filteredRows.filter((row) => {
        const cellVal = row[col] ?? "";
        return cellVal.toString().toLowerCase().includes(filterVal.toLowerCase());
      });
    }
    return filteredRows;
  }

  // Функція, що об'єднує фільтрування і сортування
  const finalFiltered = getFilteredData(decodedData);
  const finalSorted = getSortedData(finalFiltered);

  // Пагінація
  const totalPages = Math.ceil(finalSorted.length / rowsPerPage);
  const startIndex = currentPage * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentRows = finalSorted.slice(startIndex, endIndex);

  const goToFirstPage = () => setCurrentPage(0);
  const goToPreviousPage = () => setCurrentPage((prev) => Math.max(0, prev - 1));
  const goToNextPage = () => setCurrentPage((prev) => (prev < totalPages - 1 ? prev + 1 : prev));
  const goToLastPage = () => setCurrentPage(totalPages - 1);

  // -------------------------------------------------------------
  //  ОНОВЛЕННЯ ФІЛЬТРІВ
  // -------------------------------------------------------------
  const handleFilterInputChange = (col, newValue) => {
    setPendingFilters((prev) => ({ ...prev, [col]: newValue }));
  };

  const applyFilterForColumn = (col) => {
    setActiveFilters((prev) => ({
      ...prev,
      [col]: (pendingFilters[col] ?? "").trim(),
    }));
    setCurrentPage(0);
  };

  const clearFilterForColumn = (col) => {
    setPendingFilters((prev) => ({ ...prev, [col]: "" }));
    setActiveFilters((prev) => ({ ...prev, [col]: "" }));
    setCurrentPage(0);
  };

  // -------------------------------------------------------
  // Рендер
  // -------------------------------------------------------
  return (
    <div className={style.container}>
      <div className={style.card}>
        <h1>Table Converter</h1>
        <div>
          <button
            className={style.btn}
            onClick={() => initializeNewTable()}
            >
            Створити порожню таблицю
          </button>
          <GoogleSheetImporter onDataImported={handleDataImported}/>
        </div>
        {/* <div><GoogleSheetImporter onDataImported={handleDataImported}/></div> */}
        <input
          type="file"
          style={{ display: "none" }}
          ref={fileInputRef}
          onChange={handleFileImport}
          disabled={loader}
        />
        <button className={style.btn} onClick={openFileInput} disabled={loader}>
          Вибрати файл
        </button>

        <select
          className={style.btn}
          value={selectedEncoding}
          onChange={(e) => setSelectedEncoding(e.target.value)}
        >

          <option value="" disabled>виберіть кодування</option>
          <option value="utf-8">UTF-8</option>
          <option value="koi8-u">koi8-u</option>
          <option value="windows-1251">Windows-1251</option>
          <option value="windows-1252">Windows-1252</option>
          <option value="windows-1256">Windows-1256</option>
          <option value="KOI8-R">KOI8-R</option>
          <option value="iso-8859-1">ISO-8859-1</option>
          <option value="cp866">cp866</option>
        </select>

        {/* Експорт XLSX, CSV */}
        <button
          className={style.btn}
          onClick={() => setShowExportModal(true)}          >
          Експортувати
          </button>
        {showExportModal && (
          <Modal
                  isOpen={showExportModal}
                  onRequestClose={() => setShowExportModal(false)}
                  contentLabel="Export  "
                  ariaHideApp={false}
                  className="Modal exportModal"
                  overlayClassName="Overlay"
                >
          <button 
          className={style.closeModal}
          onClick={() => setShowExportModal(false)}>
          ✖
          </button>
        <button
          className={style.btn}
          disabled={!tableValid || !decodedData.length}
          onClick={() => exportFile("xlsx")}
        >
          Експорт XLSX
        </button>
        <button
          className={style.btn}
          disabled={!tableValid || !decodedData.length}
          onClick={() => exportFile("xls")}
        >
          Експорт XLS
        </button>
        <button
          className={style.btn}
          disabled={!tableValid || !decodedData.length}
          onClick={() => exportFile("csv")}
        >
          Експорт CSV
        </button>

        {/* Експорт DBF */}
        <button
          className={style.btn}
          disabled={!tableValid || !decodedData.length}
          onClick={toggleDbfExport}
        >
          Експорт в DBF
        </button>

        <GoogleSheetUploader dataArray={decodedData} />
        </Modal>
        )}

        {error && <div className={style.text_error}>{error}</div>}
        {loader && <p className={style.firstLine_loading}>loading...</p>}

        {/* КЕРУВАННЯ КОЛОНКАМИ */}
        {!!decodedData.length && (
          <div style={{ marginTop: "10px" }}>
            <h2>Колонки</h2>
            <button className={style.btn_colum_edit} onClick={addColumn}>Додати колонку</button>
            <button className={style.btn_colum_edit} onClick={() => setShowColumnModal(true)}>
                Видалити колонку
              </button>
          </div>
        )}
        {/* ----- Модальне вікно для видалення колонок ----- */}
        {showColumnModal && (
          <Modal
          isOpen={showColumnModal}
          onRequestClose={() => setShowColumnModal(false)}
          contentLabel="delete"
          ariaHideApp={false}
          className="Modal"
          overlayClassName="Overlay"
        >
              <button 
              className={style.closeModal}
                  onClick={() => setShowColumnModal(false)}>
                    ✖
                  </button>
                      <h3>Видалення колонок</h3>
                      <p>Оберіть колонку, яку потрібно видалити:</p>
                      <ul style={{ maxHeight: '60vh', overflowY: 'auto', padding: '5px', margin: '0' }}>
                        {columnOrder.map((col) => (
                          <li key={col} className={style.modal_colum_list} style={{ }}>
                            {col}{" "}
                            <button
                              className={style.btn_colum_delete}
                              onClick={() => removeColumn(col)}
                            >
                              Видалити
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button className={style.btn} onClick={() => setShowColumnModal(false)}>
                        Закрити
                      </button>
                  </Modal>
                )}
        {/* Модальне вікно для експорту в DBF */}
        {showDbfExport && (
                    <Modal
                    isOpen={showExportModal}
                    onRequestClose={() => closeModalExportModal(false)}
                    contentLabel="Export  "
                    ariaHideApp={false}
                    className="Modal"
                    overlayClassName="Overlay"
                  >
            <button 
              className={style.closeModal}
              onClick={() => closeModalExportModal(false)}>
              ✖
            </button>
            <h3 className={style.list_title}>Налаштування полів DBF</h3>

            {/* Якщо щось імпортували з DBF, покажемо чекбокс */}
            {!!fieldsConfigFromDBF.length && (
              <div className={style.autoDetect}>
              <label>
                <input
                  type="checkbox"
                  checked={useDbfFieldsFromImported}
                  onChange={(e) => setUseDbfFieldsFromImported(e.target.checked)}
                />
                Використати поля імпортованого DBF
              </label>
              </div>
            )}

            {/* Якщо НЕ використовуємо поля з DBF – можна увімкнути автодетект */}
            {!useDbfFieldsFromImported && (
              <div className={style.autoDetect}>
                <label>
                  <input
                    type="checkbox"
                    checked={autoDetectTypes}
                    onChange={(e) => setAutoDetectTypes(e.target.checked)}
                  />
                  Автовизначення типів
                </label>
                </div>
            )}
            <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0', margin: '0' }}>
            {/* Відображаємо displayFields, щоб дозволити редагування */}
            {displayFields.map((fld, idx) => (
              <div key={idx} className={style.item} style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0', margin: '0' }}>
                <div className={style.label}>{fld.name}:</div>
                <div className={style.select_grup}>
                <select
                  className={`${style.select_item} ${style.type}`}
                  value={fld.type}
                  onChange={(e) => handleDisplayFieldChange(idx, "type", e.target.value)}
                >
                  <option value="C">Character</option>
                  <option value="N">Number</option>
                  <option value="D">Date</option>
                  <option value="L">Logical</option>
                </select>
                <input
                  className={style.size}
                  type="number"    
                  value={fld.size}
                  onChange={(e) => handleDisplayFieldChange(idx, "size", e.target.value)}
                  readOnly={fld.type === "D" || fld.type === "L"}
                />
                {fld.type === "N" && (
                  <input
                    className={style.size}
                    type="number"
                    value={fld.decimal}
                    onChange={(e) => handleDisplayFieldChange(idx, "decimal", e.target.value)}
                  />
                )}
                </div>
              </div>
            ))}
            </div>
            <div className={style.encoding}>
              <label>
                Кодування DBF:
                <select
                  className={`${style.select_item} ${style.type}`}
                  value={dbfEncoding}
                  onChange={(e) => setDbfEncoding(e.target.value)}
                >
                  <option value="windows-1251">windows-1251</option>
                  <option value="cp866">cp866</option>
                  <option value="koi8-u">koi8-u</option>
                </select>
              </label>
              </div>
            <div>
            <button 
            className={style.btn}
            onClick={convertToDBF}>
              Зберегти DBF
              </button>
              <button 
            className={style.btn}
            onClick={closeModalExportModal}>
              Закрити
              </button>
            </div>
            </Modal>
        )}

        {/* ВІДОБРАЖЕННЯ РЯДКІВ (пагінація) */}
        {tableValid && columnOrder.length > 0 && (
          <div style={{ marginTop: 20, overflowX: "auto" }}>
            {/* Вибір кількості на сторінку */}
            <div style={{ marginTop: 20 }}>
              <label>
                Показати:{" "}
                <select
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(+e.target.value)}
                >
                  <option value={10}>10</option>
                  <option value={50}>50</option>
                  <option value={75}>75</option>
                  <option value={100}>100</option>
                </select>{" "}
                записів на сторінку
              </label>
            </div>
             {/* Кнопки пагінації */}
            {decodedData.length>0  && (
            <div style={{ marginTop: 10 }}>
              <button onClick={goToFirstPage} disabled={currentPage === 0}>
              🞀🞀
              </button>
              <button onClick={goToPreviousPage} disabled={currentPage === 0}>
              🞀
              </button>
              <span style={{ margin: "0 10px" }}>
                Сторінка {currentPage + 1} із {totalPages}
              </span>
              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages - 1 || totalPages === 0}
              >
                🞂
              </button>
              <button
                onClick={goToLastPage}
                disabled={currentPage === totalPages - 1 || totalPages === 0}
              >
                🞂🞂
              </button>
            </div>)}
            {/* Таблиця без записів */}
            
            {/* Таблиця з поточними (currentRows) */}
            <div className={style.tab} style={{ marginTop: 20, overflowX: "auto", maxWidth: "100%" }}>
              <table className={style.myTable}>
                <thead>
                  {/* Рядок із назвами колонок (з можливістю кліка для сортування) */}
                  <tr>
                    {columnOrder.map((col) => (
                      <th key={col}>
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => renameColumn(col, e.target.textContent.trim())}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault(); // Забороняємо перенесення рядка
                              e.target.blur(); // Викликаємо подію onBlur, текст редагується без оновлення стану в реальному часі. Оновлення відбувається лише при завершенні редагування
                            }
                          }}
                          >
                            {col}
                            </div>
                              <button 
                              style={{
                                // Якщо зараз ця колонка відсортована за ASC:
                                color: sortColumn === col && sortOrder === "asc" ? "red" : "inherit",
                              }}
                              onClick={() => handleSort(col, "asc")}>▲</button>
                              <button 
                              style={{
                                // Якщо зараз ця колонка відсортована за DESC:
                                color: sortColumn === col && sortOrder === "desc" ? "red" : "inherit",
                              }}
                              onClick={() => handleSort(col, "desc")}>▼</button>
                        </th>
                      ))}
                    <th></th>
                  </tr>
                   {/* Рядок із фільтрами */}
                  <tr>
                    {columnOrder.map((col) => (
                      <th key={col}>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <input
                            type="text"
                            placeholder="Фільтр..."
                            value={pendingFilters[col] || ""}
                            onChange={(e) => handleFilterInputChange(col, e.target.value)}
                            style={{ width: "80px" }}
                          />
                        <button onClick={() => applyFilterForColumn(col)}>✓</button>
                        {activeFilters[col] && activeFilters[col].length > 0 && (
                        <button onClick={() => clearFilterForColumn(col)}>✕</button>
                        )}
                        </div>
                        </th>
                        ))}
                    <th> </th>
                  </tr>
                </thead>
                <tbody>
                   {/* Якщо decodedData порожній, тут буде 0 <tr> */}
                  {currentRows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {columnOrder.map((col) => (
                        <td key={col}>
                          <input
                            type="text"
                            value={row[col] ?? ""}
                            onChange={(e) =>
                              handleCellChange(
                                startIndex + rowIndex,
                                col,
                                e.target.value
                              )
                            }
                          /> 
                        </td>
                      ))}
                      <td>
                        <button
                        className={style.btn_row_delete}
                          onClick={() => deleteRecord(startIndex + rowIndex)}
                        >
                          ✖
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className={style.btn_colum_edit} style={{ marginTop: 10 }} onClick={addNewRecord}>
                Додати рядок
            </button>
          </div>
        )}
        
      </div>
    </div>
  );
}
