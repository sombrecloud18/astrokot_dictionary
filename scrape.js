const cheerio = require('cheerio');
const fs = require('fs');
const iconv = require('iconv-lite');
const { stringify } = require('csv-stringify');

// Динамический импорт node-fetch
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Базовый URL словаря
const baseUrl = 'https://www.astrokot.kiev.ua/slovar/';
const dictionaryUrl = `${baseUrl}spisok.htm`;

// Функция для получения HTML страницы с учетом кодировки
async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    
    // Проверяем заголовок Content-Type для определения кодировки
    let encoding = 'utf-8';
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('charset=windows-1251')) {
      encoding = 'windows-1251';
    } else if (contentType && contentType.includes('charset=utf-8')) {
      encoding = 'utf-8';
    }
    
    const html = iconv.decode(Buffer.from(buffer), encoding);
    
    // Дополнительная проверка: если в HTML есть meta charset, используем его
    const $ = cheerio.load(html);
    const metaCharset = $('meta[http-equiv="Content-Type"], meta[charset]').attr('content') || $('meta[charset]').attr('charset');
    if (metaCharset && metaCharset.toLowerCase().includes('windows-1251') && encoding !== 'windows-1251') {
      console.log(`Обнаружен meta charset=windows-1251 для ${url}, перекодируем...`);
      return iconv.decode(Buffer.from(buffer), 'windows-1251');
    }
    
    return html;
  } catch (error) {
    console.error(`Ошибка при загрузке ${url}: ${error.message}`);
    throw error;
  }
}

// Функция для получения всех ссылок словаря
async function getDictionaryLinks() {
  let html;
  try {
    html = await fetchPage(dictionaryUrl);
  } catch (error) {
    console.error(`Не удалось загрузить ${dictionaryUrl}: ${error.message}`);
    return [];
  }
  
  const $ = cheerio.load(html);
  const links = [];
  
  // Поиск ссылок
  $('a[href$=".htm"]').each((i, elem) => {
    const href = $(elem).attr('href');
    const title = $(elem).text().trim();
    if (href && title && !href.includes('titel.htm') && !href.includes('spisok.htm')) {
      links.push({
        url: href.startsWith('http') ? href : `${baseUrl}${href}`,
        linkText: title,
      });
    }
  });
  
  console.log('Найденные ссылки:', links); // Отладочный вывод всех ссылок
  return links; // Возвращаем все ссылки
}

// Функция для парсинга данных с одной страницы
async function parsePage(linkObj) {
  const { url, linkText } = linkObj;
  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Получаем заголовок (h1 или первый td)
    let title = $('h1').text().trim();
    if (!title) {
      title = $('td').first().text().trim();
    }

    // Получаем описание (всё между заголовком и <h4>Литература</h4>, исключая саму <h4>)
    let description = [];
    let capture = false;
    $('*').each((i, elem) => {
      if ($(elem).is('h4') && $(elem).text().trim() === 'Литература') {
        capture = false;
        return false; // Прерываем цикл до добавления текста
      }
      if (capture) {
        const text = $(elem).is('p, td') ? $(elem).text().trim() : '';
        if (text && text !== 'Литература') {
          description.push(text);
        }
      }
      if ($(elem).is('h1') || ($(elem).is('td') && $(elem).text().trim() === title)) {
        capture = true;
      }
    });

    // Объединяем описание в одну строку, заменяя все переносы строк на пробелы
    const finalDescription = description.join(' ').replace(/\n/g, ' ').trim();

    // Экранируем кавычки и запятые для CSV
    return {
      url,
      linkText: linkText.replace(/"/g, '""'),
      title: title.replace(/"/g, '""'),
      description: finalDescription.replace(/"/g, '""'),
    };
  } catch (error) {
    console.warn(`Пропущена страница ${url} из-за ошибки: ${error.message}`);
    return null; // Возвращаем null для пропущенных страниц
  }
}

// Функция для записи данных в CSV с добавлением порциями по 10 страниц
async function writeToCSV(data, isFirstWrite = false) {
  const columns = {
    url: 'URL',
    linkText: 'Название страницы',
    title: 'Заголовок',
    description: 'Описание',
  };

  return new Promise((resolve, reject) => {
    stringify(
      data,
      {
        header: isFirstWrite, // Добавляем заголовки только при первой записи
        columns,
        quoted: true, // Оборачиваем все поля в кавычки
      },
      (err, output) => {
        if (err) return reject(err);
        // Если файл существует, дописываем данные, иначе создаем новый файл с заголовками
        const fileExists = fs.existsSync('dictionary.csv');
        fs.appendFileSync('dictionary.csv', output, 'utf8');
        resolve();
      }
    );
  });
}

// Основная функция
async function main() {
  try {
    console.log('Получение ссылок словаря...');
    const links = await getDictionaryLinks();
    console.log(`Найдено ${links.length} ссылок.`);

    if (links.length === 0) {
      console.warn('Предупреждение: не найдено ссылок. Проверьте структуру страницы spisok.htm.');
      return;
    }

    let results = [];
    for (let i = 0; i < links.length; i++) {
      console.log(`Парсинг страницы ${i + 1}/${links.length}: ${links[i].url}`);
      const pageData = await parsePage(links[i]);
      if (pageData) {
        results.push(pageData);
      }

      // Записываем данные каждые 10 страниц
      if ((i + 1) % 10 === 0 || i === links.length - 1) {
        console.log(`Запись данных для страниц ${i - 9 > 0 ? i - 9 : 0}-${i + 1} в dictionary.csv...`);
        await writeToCSV(results, i === 0); // Заголовки только для первой записи
        results = []; // Очищаем массив после записи
      }

      // Задержка 1 секунда для избежания блокировки
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (results.length > 0) {
      // Записываем оставшиеся данные, если их меньше 10
      console.log(`Запись оставшихся ${results.length} страниц в dictionary.csv...`);
      await writeToCSV(results, false); // Без заголовков
    }

    console.log('Все данные успешно записаны в dictionary.csv!');
    if (links.length !== fs.readFileSync('dictionary.csv', 'utf8').split('\n').length - 1) {
      console.warn(`Пропущено ${links.length - (fs.readFileSync('dictionary.csv', 'utf8').split('\n').length - 1)} страниц из-за ошибок.`);
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

main();