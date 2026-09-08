(() => {
    'use strict';

    const TELEGRAM_SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
    const LOCAL_TELEGRAM_SDK_URL = 'vendor/telegram-web-app.js?v=3549138a';
    const TELEGRAM_SDK_TIMEOUT_MS = 5000;
    const LOCAL_TELEGRAM_SDK_TIMEOUT_MS = 10000;
    const status = document.getElementById('startup-status');
    const title = document.getElementById('startup-status-title');
    const message = document.getElementById('startup-status-message');
    const retry = document.getElementById('startup-status-retry');
    let starting = false;

    function showStatus(nextTitle, nextMessage, canRetry = false) {
        status.classList.remove('hidden');
        status.setAttribute('aria-hidden', 'false');
        title.textContent = nextTitle;
        message.textContent = nextMessage;
        retry.hidden = !canRetry;
        retry.disabled = false;
    }

    function hideStatus() {
        status.remove();
    }

    function loadScript(src, { timeoutMs = 0, id = '' } = {}) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            let settled = false;
            let timer = null;

            function finish(error = null) {
                if (settled) return;
                settled = true;
                if (timer) window.clearTimeout(timer);
                script.onload = null;
                script.onerror = null;
                if (error) {
                    script.remove();
                    reject(error);
                } else {
                    resolve();
                }
            }

            script.src = src;
            script.async = true;
            if (id) script.id = id;
            script.onload = () => finish();
            script.onerror = () => finish(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);

            if (timeoutMs > 0) {
                timer = window.setTimeout(() => finish(new Error(`Timed out loading ${src}`)), timeoutMs);
            }
        });
    }

    async function ensureTelegramSdk() {
        if (window.Telegram?.WebApp) return;
        document.getElementById('telegram-web-app-sdk')?.remove();
        try {
            await loadScript(TELEGRAM_SDK_URL, { timeoutMs: TELEGRAM_SDK_TIMEOUT_MS, id: 'telegram-web-app-sdk' });
            if (!window.Telegram?.WebApp) throw new Error('Official Telegram WebApp SDK did not initialize WebApp');
            return;
        } catch (error) {
            console.warn('Официальный Telegram WebApp SDK недоступен, используется резервная копия:', error);
        }

        document.getElementById('telegram-web-app-sdk-fallback')?.remove();
        await loadScript(LOCAL_TELEGRAM_SDK_URL, {
            timeoutMs: LOCAL_TELEGRAM_SDK_TIMEOUT_MS,
            id: 'telegram-web-app-sdk-fallback'
        });
        if (!window.Telegram?.WebApp) throw new Error('Telegram WebApp SDK is unavailable');
    }

    async function start() {
        if (starting) return;
        starting = true;
        retry.disabled = true;
        showStatus('TEMLI', 'Загрузка приложения…');

        try {
            await ensureTelegramSdk();
        } catch (error) {
            console.warn('Не удалось загрузить Telegram WebApp SDK:', error);
            showStatus(
                'Не удалось загрузить TEMLI',
                'Не удалось загрузить компоненты Telegram. Проверьте соединение или откройте приложение через другую сеть.',
                true
            );
            starting = false;
            return;
        }

        const initData = String(window.Telegram.WebApp.initData || '');
        if (!initData) {
            showStatus(
                'Откройте TEMLI через Telegram',
                'Для безопасного доступа к расписанию откройте приложение кнопкой в Telegram-боте.'
            );
            starting = false;
            return;
        }

        try {
            await loadScript('i18n.js?v=30.17.2');
            await loadScript('app.js?v=30.17.2');
            hideStatus();
        } catch (error) {
            console.error('Не удалось загрузить TEMLI:', error);
            showStatus(
                'Не удалось загрузить TEMLI',
                'Обновите страницу или повторите позже.',
                true
            );
        } finally {
            starting = false;
        }
    }

    retry.addEventListener('click', start);
    start();
})();
