// ============================================================
// ИНИЦИАЛИЗАЦИЯ TELEGRAM
// ============================================================

const tg = window.Telegram.WebApp;
tg.expand();

let user = tg.initDataUnsafe?.user;

if (!user || !user.id) {
    try {
        const params = new URLSearchParams(tg.initData);
        const userData = params.get('user');
        if (userData) {
            user = JSON.parse(decodeURIComponent(userData));
        }
    } catch (e) {}
}

if (!user || !user.id) {
    user = {
        id: 380819371,
        first_name: 'R'
    };
}

console.log('✅ Пользователь:', user);

// ============================================================
// СОСТОЯНИЕ
// ============================================================

const state = {
    selectedDate: null,
    weekOffset: 0,
    schedule: {},
    students: {},
    slots: [],
    loading: false,
};

const $ = (id) => document.getElementById(id);
const scheduleContainer = $('schedule-container');
const weekLabel = $('week-label');
const btnPrev = $('btn-prev-week');
const btnNext = $('btn-next-week');
const btnToday = $('btn-today');
const btnAdd = $('btn-add-lesson');

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function getDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function formatDateDisplay(date) {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================
// ЗАГРУЗКА ДАННЫХ
// ============================================================

function loadSchedule() {
    let targetDate = state.selectedDate || getToday();
    state.selectedDate = targetDate;
    
    const monday = getMonday(targetDate);
    const offsetDate = new Date(monday);
    offsetDate.setDate(monday.getDate() + state.weekOffset * 7);
    
    const dayIndex = targetDate.getDay() === 0 ? 6 : targetDate.getDay() - 1;
    const finalDate = new Date(offsetDate);
    finalDate.setDate(offsetDate.getDate() + dayIndex);
    
    const dateKey = getDateKey(finalDate);
    state.currentDateKey = dateKey;
    
    console.log('📅 Запрос для:', dateKey);
    
    tg.sendData(JSON.stringify({
        action: 'get_schedule',
        user_id: user.id,
        date: dateKey
    }));
}

function loadStudents() {
    tg.sendData(JSON.stringify({
        action: 'get_students',
        user_id: user.id
    }));
}

// ============================================================
// ОТРИСОВКА
// ============================================================

function renderSchedule(data) {
    console.log('📊 Рендеринг:', data);
    
    if (!data || !data.slots) {
        scheduleContainer.innerHTML = `<div class="empty-state"><p>Нет данных</p></div>`;
        return;
    }

    const { slots, lessons } = data;
    const busyTimes = lessons.map(l => l.time);

    let html = '';
    let hasLessons = false;

    slots.forEach(slot => {
        const isBusy = busyTimes.includes(slot);
        const lesson = lessons.find(l => l.time === slot);

        if (isBusy && lesson) {
            hasLessons = true;
            const student = lesson.student || 'Неизвестно';
            html += `
                <div class="slot-row" data-time="${slot}">
                    <span class="slot-time">${slot}</span>
                    <span class="slot-student">${student}</span>
                    <span class="slot-bell">🔔</span>
                    <span class="slot-delete">🗑</span>
                </div>
            `;
        } else {
            html += `
                <div class="slot-row" data-time="${slot}">
                    <span class="slot-time">${slot}</span>
                    <span class="slot-empty">➕</span>
                    <span class="slot-bell"></span>
                    <span class="slot-delete"></span>
                </div>
            `;
        }
    });

    if (!hasLessons) {
        html += `<div class="empty-state"><p>Нет занятий</p></div>`;
    }

    scheduleContainer.innerHTML = html;
    updateWeekLabel();
}

function updateWeekLabel() {
    const today = getToday();
    const monday = getMonday(today);
    const startDate = new Date(monday);
    startDate.setDate(monday.getDate() + state.weekOffset * 7);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    weekLabel.textContent = `${formatDateDisplay(startDate)} – ${formatDateDisplay(endDate)}`;
}

// ============================================================
// ОБРАБОТКА ОТВЕТОВ ОТ БОТА
// ============================================================

function processBotResponse(data) {
    console.log('📥 Обработка ответа:', data);
    
    // Бот теперь отправляет чистый JSON через web_app_data
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        
        if (parsed.action === 'get_schedule') {
            renderSchedule(parsed);
        } else if (parsed.action === 'get_students') {
            state.students = parsed.students || {};
            console.log('👥 Учеников:', Object.keys(state.students).length);
        } else if (parsed.action === 'get_slots') {
            state.slots = parsed.slots || [];
        }
    } catch (e) {
        console.error('❌ Ошибка парсинга:', e);
    }
}

// ============================================================
// ПЕРЕХВАТ ОТВЕТОВ ОТ БОТА
// ============================================================

console.log('🔄 Устанавливаю перехватчик...');

// Глобальный обработчик для ответов
window.handleBotResponse = function(data) {
    console.log('📥 handleBotResponse получил:', data);
    processBotResponse(data);
};

// Telegram WebApp автоматически передаёт ответы через web_app_data
// Используем onEvent для получения данных
tg.onEvent('web_app_data', function(data) {
    console.log('📥 web_app_data событие:', data);
    processBotResponse(data);
});

// Также проверяем через initData (на случай, если ответ пришёл туда)
setInterval(() => {
    try {
        const data = window.Telegram.WebApp.initData;
        if (data && data !== state.lastData) {
            state.lastData = data;
            // Проверяем, похоже на JSON
            if (data.startsWith('{') || data.startsWith('[')) {
                console.log('📩 Найдены данные в initData');
                processBotResponse(data);
            }
        }
    } catch(e) {}
}, 1000);

console.log('✅ Перехватчик установлен');

// ============================================================
// НАВИГАЦИЯ
// ============================================================

btnPrev.addEventListener('click', () => {
    state.weekOffset--;
    loadSchedule();
});

btnNext.addEventListener('click', () => {
    state.weekOffset++;
    loadSchedule();
});

btnToday.addEventListener('click', () => {
    state.weekOffset = 0;
    state.selectedDate = getToday();
    loadSchedule();
});

btnAdd.addEventListener('click', () => {
    alert('Добавьте занятие через бота Telegram');
});

// ============================================================
// ЗАПУСК
// ============================================================

state.selectedDate = getToday();
loadSchedule();
loadStudents();

console.log('📱 App запущен');
console.log('👤 ID:', user.id);