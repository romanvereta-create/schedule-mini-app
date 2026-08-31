const tg = window.Telegram.WebApp;
tg.expand();

const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
const START_HOUR = 6;
const END_HOUR = 23;
const MIN_HOUR_HEIGHT = 40;
const MAX_HOUR_HEIGHT = 160;
const ZOOM_STEP = 20;

let hourHeight = 80;

const state = {
    currentMonday: getMonday(new Date()),
    schedule: {},
    students: {},
    selectedLesson: null,
    isMoving: false,
    pendingMove: null,
    editingExisting: false
};

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function dateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function haptic(type = 'light') {
    try { tg.HapticFeedback.impactOccurred(type); } catch (e) {}
}

function getStudentInfo(studentId) {
    const raw = state.students[studentId];
    return typeof raw === 'string' ? { name: raw } : (raw || {});
}

function getStudentColor(studentId, name) {
    const info = getStudentInfo(studentId);
    if (info.color !== undefined && info.color !== null) return Number(info.color);
    let hash = 0;
    for (const char of String(name || '')) hash = ((hash << 5) - hash) + char.charCodeAt(0);
    return Math.abs(hash) % 8;
}

async function fetchData() {
    try {
        const scheduleResponse = await fetch(`${API_URL}/get_week_schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week_start: dateKey(state.currentMonday) })
        });
        const scheduleData = await scheduleResponse.json();
        if (scheduleData.status !== 'ok') throw new Error(scheduleData.message || 'Ошибка расписания');
        state.schedule = scheduleData.schedule || {};

        const studentsResponse = await fetch(`${API_URL}/get_students`);
        const studentsData = await studentsResponse.json();
        state.students = studentsData.students || {};

        fillStudentsDropdown();
        renderCalendar();
    } catch (error) {
        console.error('Ошибка загрузки:', error);
    }
}

function fillStudentsDropdown() {
    const select = document.getElementById('student-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Выбрать ученика --</option><option value="manual">Вписать вручную...</option>';

    Object.entries(state.students).forEach(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
        const option = document.createElement('option');
        option.value = id;
        option.textContent = info.name || id;
        option.dataset.name = info.name || id;
        select.appendChild(option);
    });
}

function renderCalendar() {
    const labels = document.getElementById('time-labels');
    const grid = document.getElementById('week-grid');
    const layer = document.getElementById('events-layer');
    if (!labels || !grid || !layer) return;

    labels.innerHTML = '';
    grid.innerHTML = '';
    layer.innerHTML = '<div id="current-time-line" class="current-time-line hidden"><div class="time-line-dot"></div></div>';
    document.documentElement.style.setProperty('--hour-height', `${hourHeight}px`);

    const middleDate = new Date(state.currentMonday);
    middleDate.setDate(middleDate.getDate() + 3);
    document.getElementById('month-label').textContent = middleDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

    const todayKey = dateKey(new Date());
    const header = document.getElementById('days-header');
    header.innerHTML = '';

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayDate = new Date(state.currentMonday);
        dayDate.setDate(dayDate.getDate() + dayIndex);
        const cell = document.createElement('div');
        cell.className = `day-header-cell ${dateKey(dayDate) === todayKey ? 'today' : ''}`;
        cell.innerHTML = `<div>${['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'][dayIndex]}</div><div class="day-num">${dayDate.getDate()}</div>`;
        header.appendChild(cell);
    }

    for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
        const label = document.createElement('div');
        label.className = 'time-label';
        label.style.height = `${hourHeight}px`;
        label.textContent = `${String(hour).padStart(2, '0')}:00`;
        labels.appendChild(label);
    }

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const column = document.createElement('div');
        column.className = 'day-column';
        const dayDate = new Date(state.currentMonday);
        dayDate.setDate(dayDate.getDate() + dayIndex);
        const key = dateKey(dayDate);

        for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.style.height = `${hourHeight}px`;
            slot.addEventListener('click', () => {
                const time = `${String(hour).padStart(2, '0')}:00`;
                if (state.isMoving) confirmMoveTarget(key, time);
                else openAddModal(key, time);
            });
            column.appendChild(slot);
        }
        grid.appendChild(column);
    }

    renderEvents();
    updateCurrentTimeLine();
}

function renderEvents() {
    const layer = document.getElementById('events-layer');
    const colWidth = layer.clientWidth / 7;

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayDate = new Date(state.currentMonday);
        dayDate.setDate(dayDate.getDate() + dayIndex);
        const key = dateKey(dayDate);
        const lessons = state.schedule[key] || [];

        lessons.forEach(lesson => {
            const [hour, minute] = String(lesson.time || '00:00').split(':').map(Number);
            if (hour < START_HOUR || hour > END_HOUR) return;

            const duration = Math.max(5, parseInt(lesson.duration || 60, 10));
            const card = document.createElement('div');
            const isActiveMove = state.isMoving && state.selectedLesson && state.selectedLesson.id === lesson.id;
            const color = getStudentColor(lesson.student_id, lesson.student);
            card.className = `event-card color-${color} ${lesson.paid ? 'paid-status' : ''} ${isActiveMove ? 'moving-active' : ''}`;

            const top = ((hour - START_HOUR) * 60 + minute) * hourHeight / 60;
            const height = Math.max(18, duration * hourHeight / 60 - 2);
            card.style.top = `${top}px`;
            card.style.left = `${dayIndex * colWidth + 2}px`;
            card.style.width = `${Math.max(20, colWidth - 4)}px`;
            card.style.height = `${height}px`;

            const title = document.createElement('div');
            title.className = 'event-title';
            title.textContent = lesson.student || 'Ученик';
            const time = document.createElement('div');
            time.className = 'event-time';
            time.textContent = `${lesson.time} (${duration} мин)`;
            card.append(title, time);

            let longPressed = false;
            let timer = null;
            card.addEventListener('touchstart', () => {
                longPressed = false;
                timer = setTimeout(() => {
                    longPressed = true;
                    haptic('heavy');
                    startMove(key, lesson);
                }, 550);
            }, { passive: true });
            card.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
            card.addEventListener('touchend', () => clearTimeout(timer));
            card.addEventListener('contextmenu', event => {
                event.preventDefault();
                openActionMenu(key, lesson);
            });
            card.addEventListener('click', event => {
                event.stopPropagation();
                if (longPressed || state.isMoving) return;
                openActionMenu(key, lesson);
            });
            layer.appendChild(card);
        });
    }
}

function updateCurrentTimeLine() {
    const line = document.getElementById('current-time-line');
    if (!line) return;
    const now = new Date();
    let todayColumn = -1;

    for (let i = 0; i < 7; i++) {
        const date = new Date(state.currentMonday);
        date.setDate(date.getDate() + i);
        if (dateKey(date) === dateKey(now)) todayColumn = i;
    }

    if (todayColumn < 0 || now.getHours() < START_HOUR || now.getHours() > END_HOUR) {
        line.classList.add('hidden');
        return;
    }

    const columnWidth = document.getElementById('events-layer').clientWidth / 7;
    const minutes = now.getHours() * 60 + Math.floor(now.getMinutes() / 10) * 10 - START_HOUR * 60;
    line.style.top = `${minutes * hourHeight / 60}px`;
    line.style.left = `${todayColumn * columnWidth}px`;
    line.style.width = `${columnWidth}px`;
    line.classList.remove('hidden');
}

setInterval(updateCurrentTimeLine, 60000);

function openActionMenu(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    document.getElementById('action-menu-title').textContent = lesson.student || 'Ученик';
    document.getElementById('btn-action-paid').textContent = lesson.paid ? '✅ Оплачено (снять)' : '💳 Оплатил';
    document.getElementById('action-menu-overlay').classList.remove('hidden');
}

function closeActionMenu() {
    document.getElementById('action-menu-overlay').classList.add('hidden');
}

function startMove(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    state.isMoving = true;
    document.getElementById('move-hint').classList.remove('hidden');
    renderCalendar();
}

function confirmMoveTarget(newDate, newTime) {
    state.pendingMove = { newDate, newTime };
    document.getElementById('move-modal-desc').textContent = `${state.selectedLesson.student}: ${newDate}, ${newTime}`;
    document.getElementById('move-modal-overlay').classList.remove('hidden');
}

async function executeMove(actionType) {
    if (!state.selectedLesson || !state.pendingMove) return;
    const payload = {
        old_date: state.selectedLesson.date,
        id: state.selectedLesson.id,
        new_date: state.pendingMove.newDate,
        new_time: state.pendingMove.newTime,
        action_type: actionType
    };
    await fetch(`${API_URL}/move_lesson`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    cancelMove();
    fetchData();
}

function cancelMove() {
    state.isMoving = false;
    state.selectedLesson = null;
    state.pendingMove = null;
    document.getElementById('move-hint').classList.add('hidden');
    document.getElementById('move-modal-overlay').classList.add('hidden');
    renderCalendar();
}

function resetAddForm() {
    document.getElementById('student-select').value = '';
    document.getElementById('manual-student-name').value = '';
    document.getElementById('manual-student-name').classList.add('hidden');
    document.getElementById('parent-contact').value = '';
    document.getElementById('parent-contact-type').value = 'tg';
    document.querySelectorAll('.contact-type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === 'tg'));
    document.getElementById('reminder-minutes').value = '60';
    document.getElementById('reminder-text').value = '';
    document.getElementById('zoom-link').value = '';
    document.getElementById('lesson-repeat').value = 'no';
}

function openAddModal(date, time) {
    state.selectedLesson = null;
    state.editingExisting = false;
    document.getElementById('modal-title').textContent = 'Добавить занятие';
    document.getElementById('student-select-group').classList.remove('hidden');
    document.getElementById('student-fixed-group').classList.add('hidden');
    document.getElementById('time-duration-group').classList.remove('hidden');
    document.getElementById('repeat-group').classList.remove('hidden');
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = time;
    document.getElementById('lesson-duration').value = '60';
    document.getElementById('lesson-price').value = '';
    resetAddForm();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEditModal(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    state.editingExisting = true;
    document.getElementById('modal-title').textContent = 'Настройки ученика';
    document.getElementById('student-select-group').classList.add('hidden');
    document.getElementById('student-fixed-group').classList.remove('hidden');
    document.getElementById('fixed-student-name').value = lesson.student || '';
    document.getElementById('time-duration-group').classList.add('hidden');
    document.getElementById('repeat-group').classList.add('hidden');
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = lesson.time || '10:00';
    document.getElementById('lesson-duration').value = lesson.duration || 60;
    document.getElementById('lesson-id').value = lesson.id || '';
    document.getElementById('lesson-price').value = lesson.price || '';
    document.getElementById('parent-contact').value = lesson.parent_contact || getStudentInfo(lesson.student_id).parent_contact || '';
    document.getElementById('parent-contact-type').value = lesson.parent_contact_type || getStudentInfo(lesson.student_id).parent_contact_type || 'tg';
    document.getElementById('reminder-minutes').value = lesson.reminder_minutes ?? 60;
    document.getElementById('reminder-text').value = lesson.reminder_text || '';
    document.getElementById('zoom-link').value = lesson.zoom_link || '';
    document.querySelectorAll('.contact-type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === document.getElementById('parent-contact-type').value));
    document.getElementById('modal-overlay').classList.remove('hidden');
}

async function saveLesson() {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    const duration = parseInt(document.getElementById('lesson-duration').value || 60, 10);
    const price = document.getElementById('lesson-price').value;
    const contact = document.getElementById('parent-contact').value.trim();
    const contactType = document.getElementById('parent-contact-type').value;
    let student = '';
    let studentId = '';

    if (state.editingExisting) {
        student = state.selectedLesson.student;
        studentId = state.selectedLesson.student_id;
    } else {
        const select = document.getElementById('student-select');
        if (select.value === 'manual') student = document.getElementById('manual-student-name').value.trim();
        else if (select.value) {
            student = select.options[select.selectedIndex].dataset.name;
            studentId = select.value;
        }
    }

    if (!student || !time) return alert('Укажите ученика и время');

    const payload = {
        date, time, duration, student, student_id: studentId, price,
        parent_contact: contact, parent_contact_type: contactType,
        reminder_minutes: document.getElementById('reminder-minutes').value,
        reminder_text: document.getElementById('reminder-text').value,
        zoom_link: document.getElementById('zoom-link').value,
        repeat: document.getElementById('lesson-repeat').value
    };
    const endpoint = state.editingExisting ? '/update_lesson' : '/add_lesson';
    if (state.editingExisting) payload.id = state.selectedLesson.id;

    const response = await fetch(API_URL + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения');
    closeAllModals();
    fetchData();
}

function closeAllModals() {
    ['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'color-modal-overlay'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

// Переключатель ручного ввода — исправлено: обработчик установлен после загрузки DOM.
document.getElementById('student-select').addEventListener('change', event => {
    const input = document.getElementById('manual-student-name');
    const manual = event.target.value === 'manual';
    input.classList.toggle('hidden', !manual);
    if (manual) input.focus();
});

// Меню действий
document.getElementById('btn-action-settings').onclick = () => { closeActionMenu(); if (state.selectedLesson) openEditModal(state.selectedLesson.date, state.selectedLesson); };
document.getElementById('btn-action-move-trigger').onclick = () => { closeActionMenu(); if (state.selectedLesson) startMove(state.selectedLesson.date, state.selectedLesson); };
document.getElementById('btn-action-paid').onclick = async () => {
    const lesson = state.selectedLesson;
    await fetch(`${API_URL}/mark_paid`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: lesson.date, id: lesson.id, paid: !lesson.paid }) });
    closeActionMenu();
    fetchData();
};
document.getElementById('btn-action-color').onclick = () => { closeActionMenu(); document.getElementById('color-modal-overlay').classList.remove('hidden'); };
document.querySelectorAll('.color-circle').forEach(circle => {
    circle.addEventListener('click', async () => {
        await fetch(`${API_URL}/update_student_color`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id: state.selectedLesson.student_id, color: circle.dataset.color }) });
        closeAllModals();
        fetchData();
    });
});
document.getElementById('btn-color-close').onclick = closeAllModals;
document.getElementById('btn-action-delete').onclick = () => { closeActionMenu(); document.getElementById('delete-modal-overlay').classList.remove('hidden'); };
document.getElementById('btn-action-close').onclick = closeActionMenu;
document.getElementById('btn-action-chat-student').onclick = () => { const id = state.selectedLesson?.student_id; const info = getStudentInfo(id); if (info.username) tg.openTelegramLink(`https://t.me/${info.username}`); else if (id && !String(id).startsWith('manual')) tg.openTelegramLink(`tg://user?id=${id}`); else alert('Нет Telegram-контакта'); closeActionMenu(); };
document.getElementById('btn-action-chat-parent').onclick = () => { const lesson = state.selectedLesson; const info = getStudentInfo(lesson?.student_id); const contact = lesson?.parent_contact || info.parent_contact; if (contact) alert(`Контакт родителя: ${contact}`); else alert('Контакт родителя не указан'); closeActionMenu(); };

// Удаление
document.getElementById('btn-delete-once').onclick = async () => { const l = state.selectedLesson; await fetch(`${API_URL}/delete_lesson`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: l.date, id: l.id, delete_all: false }) }); closeAllModals(); fetchData(); };
document.getElementById('btn-delete-all').onclick = async () => { const l = state.selectedLesson; await fetch(`${API_URL}/delete_lesson`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: l.date, id: l.id, delete_all: true }) }); closeAllModals(); fetchData(); };
document.getElementById('btn-delete-cancel').onclick = closeAllModals;

// Перенос
document.getElementById('btn-action-copy').onclick = () => executeMove('copy');
document.getElementById('btn-action-move-once').onclick = () => executeMove('move_once');
document.getElementById('btn-action-move-all').onclick = () => executeMove('move_all');
document.getElementById('btn-action-move-cancel').onclick = cancelMove;
document.getElementById('btn-cancel-move').onclick = cancelMove;

// Кнопки и закрытие
document.getElementById('btn-save').onclick = saveLesson;
document.getElementById('btn-cancel-modal').onclick = closeAllModals;
document.getElementById('btn-close-modal').onclick = closeAllModals;
document.getElementById('btn-action-close').onclick = closeActionMenu;
['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'color-modal-overlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', event => { if (event.target.id === id) closeAllModals(); });
});

// Контакты — иконки-маркеры типа связи
document.querySelectorAll('.contact-type-btn').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.contact-type-btn').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        document.getElementById('parent-contact-type').value = button.dataset.type;
    });
});

// Дата и навигация
document.getElementById('month-label').onclick = () => { const input = document.getElementById('date-picker-input'); input.showPicker ? input.showPicker() : input.click(); };
document.getElementById('date-picker-input').onchange = event => { if (!event.target.value) return; const [y, m, d] = event.target.value.split('-').map(Number); state.currentMonday = getMonday(new Date(y, m - 1, d)); fetchData(); };
document.getElementById('btn-today').onclick = () => { state.currentMonday = getMonday(new Date()); fetchData(); };
document.getElementById('btn-prev-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate() - 7); fetchData(); };
document.getElementById('btn-next-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate() + 7); fetchData(); };
document.getElementById('btn-zoom-in').onclick = () => { hourHeight = Math.min(MAX_HOUR_HEIGHT, hourHeight + ZOOM_STEP); renderCalendar(); };
document.getElementById('btn-zoom-out').onclick = () => { hourHeight = Math.max(MIN_HOUR_HEIGHT, hourHeight - ZOOM_STEP); renderCalendar(); };

// Более устойчивый pinch: учитывается вертикальная проекция, даже если пальцы движутся по диагонали.
let pinchStartY = null;
let pinchStartHeight = hourHeight;
const calendarContainer = document.getElementById('calendar-container');
calendarContainer.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
        pinchStartY = Math.abs(event.touches[0].clientY - event.touches[1].clientY);
        pinchStartHeight = hourHeight;
    }
}, { passive: true });
calendarContainer.addEventListener('touchmove', event => {
    if (event.touches.length !== 2 || pinchStartY === null) return;
    event.preventDefault();
    const currentY = Math.abs(event.touches[0].clientY - event.touches[1].clientY);
    const difference = currentY - pinchStartY;
    hourHeight = Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, pinchStartHeight + difference * 0.6));
    renderCalendar();
}, { passive: false });
calendarContainer.addEventListener('touchend', event => { if (event.touches.length < 2) pinchStartY = null; });

window.addEventListener('resize', () => requestAnimationFrame(() => renderCalendar()));
fetchData();
