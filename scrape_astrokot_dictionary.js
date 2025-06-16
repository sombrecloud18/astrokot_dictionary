const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const { URL } = require('url');

function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function extractDescription($) {
    let content = $('#text').length ? $('#text') : $('body');
    if (content.length) {
        content.find('script, style, nav, header, footer, .menu').remove();
        let text = content.text().replace(/\s+/g, ' ').trim();
        return cleanText(text) || 'Описание не найдено';
    }
    return 'Описание не найдено';
}


async function scrapeAstrokotDictionary() {
    const baseUrl = 'https://www.astrokot.kiev.ua/slovar/slovar.htm';
    const data = [];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    try {
        const response = await axios.get(baseUrl, { headers, timeout: 30000 });
        const $ = cheerio.load(response.data);

        let frameUrl = $('frame[name="main"]').attr('src');
        let dictionaryLinks = [];
        if (frameUrl) {
            frameUrl = new URL(frameUrl, baseUrl).href;
            console.log(`Найден фрейм: ${frameUrl}`);
            const frameResponse = await axios.get(frameUrl, { headers, timeout: 30000 });
            const frame$ = cheerio.load(frameResponse.data);
            dictionaryLinks = frame$('a[href]').map((i, el) => {
                const href = frame$(el).attr('href');
                if (href && (href.startsWith('../') || href.startsWith('slovar/') || href.includes('.htm'))) {
                    return new URL(href, baseUrl).href;
                }
            }).get().filter(Boolean);
        } else {
            console.log('Фреймы не найдены, ищем ссылки на главной странице');
            dictionaryLinks = $('a[href]').map((i, el) => {
                const href = $(el).attr('href');
                if (href && (href.startsWith('../') || href.startsWith('slovar/') || href.includes('.htm'))) {
                    return new URL(href, baseUrl).href;
                }
            }).get().filter(Boolean);
        }

        dictionaryLinks = [...new Set(dictionaryLinks)];
        console.log(`Найдено ${dictionaryLinks.length} уникальных ссылок на страницы словаря`);

        for (const link of dictionaryLinks) {
            try {
                const pageResponse = await axios.get(link, { headers, timeout: 30000 });
                const page$ = cheerio.load(pageResponse.data);

                let title = 'Заголовок не найден';
                const titleTag = page$('h1, h2, h3').first();
                if (titleTag.length) {
                    title = cleanText(titleTag.text());
                } else {
                    const titleFromTag = page$('title').text();
                    title = cleanText(titleFromTag) || title;
                }

                const description = extractDescription(page$);

                data.push({
                    URL: link,
                    Заголовок: title,
                    Описание: description
                });

                console.log(`Обработано: ${title} с ${link}`);

                await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 1000));

            } catch (error) {
                console.error(`Ошибка при обработке ${link}: ${error.message}`);
                data.push({
                    URL: link,
                    Заголовок: 'Ошибка',
                    Описание: `Ошибка при загрузке: ${error.message}`
                });
            }
        }
        const csvHeader = '\uFEFFURL,Заголовок,Описание\n';
        const csvRows = data.map(row =>
            `"${row.URL.replace(/"/g, '""')}","${row.Заголовок.replace(/"/g, '""')}","${row.Описание.replace(/"/g, '""')}"`
        ).join('\n');
        fs.writeFileSync('astrokot_dictionary.csv', csvHeader + csvRows, 'utf8');
        console.log('Данные сохранены в astrokot_dictionary.csv');

    } catch (error) {
        console.error(`Ошибка при загрузке главной страницы ${baseUrl}: ${error.message}`);
    }
}


scrapeAstrokotDictionary();