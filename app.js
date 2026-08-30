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
// НАСТРОЙКА API
// ============================================================

const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';

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
    currentDateKey: null
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
// ЗАГРУЗКА И МОДИФИКАЦИЯ ДАННЫХ ЧЕРЕЗ API
// ============================================================

async function loadSchedule() {
    state.loading = true;
    
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
    
    try {
        const response = await fetch(`${API_URL}/get_schedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                date: dateKey,
                user_id: user.id
            })
        });
        
        const data = await response.json();
        console.log('📥 Ответ API:', data);
        
        if (data.status === 'ok') {
            renderSchedule(data);
        } else {
            console.error('❌ Ошибка API:', data.message);
            showError(data.message || 'Ошибка загрузки');
        }
    } catch (error) {
        console.error('❌ Ошибка сети:', error);
        showError('Не удалось загрузить расписание');
    }
    
    state.loading = false;
}

async function loadStudents() {
    try {
        const response = await fetch(`${API_URL}/get_students`);
        const data = await response.json();
        if (data.status === 'ok') {
            state.students = data.students || {};
            console.log('👥 Учеников:', Object.keys(state.students).length);
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки учеников:', error);
    }
}

async function addLesson(time, studentName) {
    if (!time || !studentName) return;
    
    try {
        const response = await fetch(`${API_URL}/add_lesson`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: state.currentDateKey,
                time: time,
                student: studentName,
                user_id: user.id
            })
        });
        
        const data = await response.json();
        if (data.status === 'ok') {
            await loadSchedule();
        } else {
            alert(data.message || 'Ошибка добавления');
        }
    } catch (error) {
        console.error('❌ Ошибка добавления занятия:', error);
        alert('Не удалось добавить занятие');
    }
}

async function deleteLesson(time) {
    if (!confirm(`Удалить занятие на ${time}?`)) return;
    
    try {
        const response = await fetch(`${API_URL}/delete_lesson`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: state.currentDateKey,
                time: time,
                user_id: user.id
            })
        });
        
        const data = await response.json();
        if (data.status === 'ok') {
            await loadSchedule();
        } else {
            alert(data.message || 'Ошибка удаления');
        }
    } catch (error) {
        console.error('❌ Ошибка удаления занятия:', error);
        alert('Не удалось удалить занятие');
    }
}

function showError(message) {
    scheduleContainer.innerHTML = `
        <div class="empty-state">
            <div class="big-icon">❌</div>
            <p>${message}</p>
        </div>
    `;
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
    state.slots = slots;
    const busyTimes = lessons.map(l => l.time);

    let html = '';

    slots.forEach(slot => {
        const isBusy = busyTimes.includes(slot);
        const lesson = lessons.find(l => l.time === slot);

        if (isBusy && lesson) {
            const student = lesson.student || 'Неизвестно';
            html += `
                <div class="slot-row" data-time="${slot}">
                    <span class="slot-time">${slot}</span>
                    <span class="slot-student">${student}</span>
                    <span class="slot-bell">🔔</span>
                    <span class="slot-delete" data-action="delete" data-time="${slot}">🗑</span>
                </div>
            `;
        } else {
            html += `
                <div class="slot-row" data-time="${slot}">
                    <span class="slot-time">${slot}</span>
                    <span class="slot-empty" data-action="add" data-time="${slot}">➕</span>
                    <span class="slot-bell"></span>
                    <span class="slot-delete"></span>
                </div>
            `;
        }
    });

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
// СОБЫТИЯ И НАВИГАЦИЯ
// ============================================================

scheduleContainer.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-action="delete"]');
    if (deleteBtn) {
        const time = deleteBtn.getAttribute('data-time');
        deleteLesson(time);
        return;
    }

    const addBtn = e.target.closest('[data-action="add"]');
    const slotRow = e.target.closest('.slot-row');
    if (addBtn || (slotRow && slotRow.querySelector('.slot-empty'))) {
        const time = (addBtn || slotRow).getAttribute('data-time');
        const studentName = prompt(`Введите имя ученика на ${time}:`);
        if (studentName && studentName.trim()) {
            addLesson(time.trim(), studentName.trim());
        }
    }
});

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
    const time = prompt('Введите время слота (например, 10:00 или 14:00):');
    if (!time) return;
    const studentName = prompt(`Введите имя ученика на ${time}:`);
    if (studentName && studentName.trim()) {
        addLesson(time.trim(), studentName.trim());
    }
});

// ============================================================
// ЗАПУСК
// ============================================================

state.selectedDate = getToday();
loadSchedule();
loadStudents();

console.log('📱 App запущен');
console.log('👤 ID:', user.id);
console.log('🌐 API:', API_URL);
