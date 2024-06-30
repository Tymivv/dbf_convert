import iconv from 'iconv-lite';

export const decodeString = (str) => {
  const encodings = ['utf-8', 'windows-1251', 'windows-1252', 'iso-8859-1'];

  for (const encoding of encodings) {
    try {
      const decoded = iconv.decode(Buffer.from(str, 'binary'), encoding);
      if (/^[\x00-\x7F]*$/.test(decoded) === false) {
        return decoded;
      }
    } catch (e) {
      
    }
  }

  return str; 
};
