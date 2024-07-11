import iconv from 'iconv-lite';
import { Buffer } from 'buffer';

export const decodeString = (str, encoding) => {
  try {
    const buffer = Buffer.from(str, 'binary');
    const decoded = iconv.decode(buffer, encoding);
    return decoded;
  } catch (e) {
    return str; // Якщо не вдалося декодувати, повертаємо оригінальний рядок
  }
};