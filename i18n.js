(() => {
    const VERSION = '31.1.1-rc1';
    const LANGUAGES = {
        ru: { label: 'Русский', locale: 'ru-RU', currency: 'RUB' },
        en: { label: 'English', locale: 'en-US', currency: 'USD' },
    };
    const CURRENCIES = {
        RUB: { symbol: '₽', label: 'RUB — ₽' },
        USD: { symbol: '$', label: 'USD — $' },
        EUR: { symbol: '€', label: 'EUR — €' },
        CNY: { symbol: '¥', label: 'CNY — ¥' },
        TRY: { symbol: '₺', label: 'TRY — ₺' }
    };
    const dictionaries = { ru: {} };
    const supplementalDictionaries = { en: {
        'Что добавить?': 'What would you like to add?',
        'Занятие с учеником': 'Individual lesson',
        'Групповое занятие': 'Group lesson',
        'Добавить групповое занятие': 'Add group lesson',
        'Личное дело': 'Personal event',
        'Добавить личное дело': 'Add personal event',
        'Название': 'Title',
        'Заметки': 'Notes',
        'Необязательно': 'Optional',
        'Например: врач, встреча, дорога': 'For example: appointment, meeting, travel',
        'Заметки видны только владельцу расписания.': 'Notes are visible only to the schedule owner.',
        'Без заметок': 'No notes',
        'Изменить': 'Edit',
        'Личное дело в выходной': 'Personal event on a day off',
        'Это ваш выходной день. Всё равно добавить личное дело?': 'This is your day off. Add the personal event anyway?',
        'Действие с личным делом': 'Personal event action',
        'Добавить ещё одним личным делом': 'Add another personal event',
        'Удаление личного дела': 'Delete personal event',
        'Как удалить личное дело?': 'How should this personal event be deleted?',
        'Удалить только это личное дело': 'Delete only this personal event',
        'Удалить все будущие повторы': 'Delete all future occurrences'
        ,'Личные дела': 'Personal events'
        ,'Нажмите свободный слот и выберите «Личное дело». Укажите название, время, длительность и при необходимости заметки.': 'Tap an empty slot and choose “Personal event”. Enter a title, time, duration, and optional notes.'
        ,'Нажмите свободный слот и выберите': 'Tap an empty slot and choose'
        ,'«Личное дело»': '“Personal event”'
        ,'. Укажите название, время, длительность и при необходимости заметки.': '. Enter a title, time, duration, and optional notes.'
        ,'Личное дело занимает время и исключается из свободных окон, но не связано с учениками, оплатами и уведомлениями.': 'A personal event blocks its time in available windows but is not connected to students, payments, or notifications.'
        ,'Заметки видны только владельцу расписания и не показываются прямо на календарной карточке.': 'Notes are visible only to the schedule owner and are not shown directly on the calendar card.'
        ,'Личный бот и уведомления': 'Personal bot and notifications'
        ,'Сообщения ученикам и родителям отправляются через личного бота преподавателя. Подключите его в настройках, а получателей подтвердите в карточке ученика.': 'Messages to students and parents are sent through the teacher’s personal bot. Connect it in settings and confirm recipients in the student profile.'
    } };
    const dictionaryEntries = { ru: [] };
    const loading = {};
    const textState = new WeakMap();
    const attrState = new WeakMap();
    let language = localStorage.getItem('temli-language') || 'ru';
    let currency = localStorage.getItem('temli-currency') || 'RUB';
    if (!LANGUAGES[language]) language = 'ru';
    if (!CURRENCIES[currency]) currency = 'RUB';

    function currencySymbol() {
        return CURRENCIES[currency]?.symbol || '₽';
    }

    function replaceCurrency(value) {
        return String(value ?? '')
            .replaceAll('₽', currencySymbol())
            .replace(/\bруб\.?\b/giu, currencySymbol());
    }

    function translated(value, { fragments = true } = {}) {
        const source = String(value ?? '');
        if (!source || language === 'ru') return replaceCurrency(source);
        const dictionary = dictionaries[language] || {};
        const leading = source.match(/^\s*/)?.[0] || '';
        const trailing = source.match(/\s*$/)?.[0] || '';
        const core = source.slice(leading.length, source.length - trailing.length);
        let result = dictionary[core];
        if (result == null) {
            result = core;
            if (fragments) {
                for (const [from, to] of (dictionaryEntries[language] || [])) {
                    if (result.includes(from)) result = result.split(from).join(to);
                }
            }
        }
        return leading + replaceCurrency(result) + trailing;
    }

    function shouldSkip(node) {
        const parent = node.parentElement;
        return !parent || Boolean(parent.closest('script, style, svg, [data-i18n-ignore]'));
    }

    function translateTextNode(node) {
        if (shouldSkip(node) || !node.nodeValue?.trim()) return;
        let record = textState.get(node);
        if (!record) record = { source: node.nodeValue, last: node.nodeValue };
        else if (node.nodeValue !== record.last) record.source = node.nodeValue;
        const next = translated(record.source);
        record.last = next;
        textState.set(node, record);
        if (node.nodeValue !== next) node.nodeValue = next;
    }

    function translateAttributes(element) {
        if (!(element instanceof Element) || element.closest('script, style, svg, [data-i18n-ignore]')) return;
        let records = attrState.get(element);
        if (!records) records = {};
        for (const name of ['placeholder', 'title', 'aria-label']) {
            if (!element.hasAttribute(name)) continue;
            const current = element.getAttribute(name) || '';
            let record = records[name];
            if (!record) record = { source: current, last: current };
            else if (current !== record.last) record.source = current;
            const next = translated(record.source);
            record.last = next;
            records[name] = record;
            if (current !== next) element.setAttribute(name, next);
        }
        attrState.set(element, records);
    }

    function apply(root = document.body) {
        if (!root) return;
        if (root.nodeType === Node.TEXT_NODE) {
            translateTextNode(root);
            return;
        }
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
        if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (walker.currentNode.nodeType === Node.TEXT_NODE) translateTextNode(walker.currentNode);
            else translateAttributes(walker.currentNode);
        }
        document.documentElement.lang = language;
        const dateInputLanguage = language === 'en' ? 'en-US' : 'ru-RU';
        document.querySelectorAll('input[type="date"]').forEach(input => { input.lang = dateInputLanguage; });
        document.title = translated('TEMLI — расписание');
    }

    function register(code, dictionary) {
        if (LANGUAGES[code] && dictionary && typeof dictionary === 'object') {
            dictionaries[code] = { ...(supplementalDictionaries[code] || {}), ...dictionary };
            dictionaryEntries[code] = Object.entries(dictionary)
                .filter(([from]) => from.length >= 3)
                .sort((a, b) => b[0].length - a[0].length);
        }
    }

    function ensureLanguage(code) {
        if (code === 'ru' || dictionaries[code]) return Promise.resolve();
        if (loading[code]) return loading[code];
        loading[code] = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `locales/${code}.js?v=${VERSION}`;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Locale ${code} could not be loaded`));
            document.head.appendChild(script);
        });
        return loading[code];
    }

    async function setLanguage(code, { persist = true } = {}) {
        const safeCode = LANGUAGES[code] ? code : 'ru';
        await ensureLanguage(safeCode);
        language = safeCode;
        if (persist) localStorage.setItem('temli-language', safeCode);
        apply();
        window.dispatchEvent(new CustomEvent('temli-language-change', { detail: { language } }));
        return language;
    }

    function setCurrency(code, { persist = true } = {}) {
        currency = CURRENCIES[code] ? code : 'RUB';
        if (persist) localStorage.setItem('temli-currency', currency);
        document.documentElement.style.setProperty('--currency-symbol', `"${currencySymbol()}"`);
        apply();
        return currency;
    }

    function formatNumber(value, options = {}) {
        return Number(value || 0).toLocaleString(LANGUAGES[language]?.locale || 'ru-RU', options);
    }

    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    window.alert = message => nativeAlert(translated(message, { fragments: false }));
    window.confirm = message => nativeConfirm(translated(message, { fragments: false }));

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') translateTextNode(mutation.target);
            else {
                for (const node of mutation.addedNodes) apply(node);
                if (mutation.type === 'attributes') translateAttributes(mutation.target);
            }
        }
    });
    let initialized = false;
    function initialize() {
        if (initialized) return;
        initialized = true;
        document.documentElement.style.setProperty('--currency-symbol', `"${currencySymbol()}"`);
        apply();
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['placeholder', 'title', 'aria-label']
        });
        setLanguage(language).catch(error => console.warn('TEMLI locale:', error));
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }

    window.TEMLI_I18N = {
        VERSION, LANGUAGES, CURRENCIES, register, apply, translated,
        setLanguage, setCurrency, language: () => language,
        currency: () => currency, currencySymbol,
        locale: () => LANGUAGES[language]?.locale || 'ru-RU',
        recommendedCurrency: code => LANGUAGES[code]?.currency || 'RUB',
        formatNumber
    };
})();
