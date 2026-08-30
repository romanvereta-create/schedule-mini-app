const tg = window.Telegram.WebApp;
tg.expand();

const user = tg.initDataUnsafe?.user || { id: 380819371, first_name: 'Преподаватель' };
const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 80;

const state = {
    currentMonday: getMonday(new Date()),
    schedule: {},
    students: {},
    selectedLesson: null,
    isMoving: false
};

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function haptic(type = 'light') {
    try { tg.HapticFeedback.impactOccurred(type); } catch (e) {}
}

function lessonColor(name) {
    let hash = 0;
    for (const char of String(name || '')) hash = ((hash << 5) - hash) + char.charCodeAt(0);
    return Math.abs(hash) % 8;
}

function dateFromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

async function fetchWeekSchedule() {
    try {
        const response = await fetch(`${API_URL}/get_week_schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week_start: formatDateKey(state.currentMonday) })
        });
        const data = await response.json();
        if (data.status !== 'ok') throw new Error(data.message || 'Ошибка API');
        state.schedule = data.schedule || {};
        renderCalendar();
    } catch (error) {
        console.error(error);
        alert('Не удалось загрузить расписание');
    }
}

async function fetchStudents() {
    try {
        const response = await fetch(`${API_URL}/get_students`);
        const data = await response.json();
        if (data.status === 'ok') state.students = data.students || {};
    } catch (error) {
        console.error(error);
    }
}

function renderHeader() {
    const monthLabel = document.getElementById('month-label');
    const daysHeader = document.getElementById('days-header');
    const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const middle = new Date(state.currentMonday);
    middle.setDate(middle.getDate() + 3);
    monthLabel.textContent = `${months[middle.getMonth()]} ${middle.getFullYear()}`;
    daysHeader.innerHTML = '';
    const today = formatDateKey(new Date());
    for (let i = 0; i < 7; i++) {
        const d = new Date(state.currentMonday);
        d.setDate(d.getDate() + i);
        const cell = document.createElement('div');
        cell.className = `day-header-cell ${formatDateKey(d) === today ? 'today' : ''}`;
        cell.innerHTML = `<div>${['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'][i]}</div><div class="day-num">${d.getDate()}</div>`;
        daysHeader.appendChild(cell);
    }
}

function renderGrid() {
    const labels = document.getElementById('time-labels');
    const grid = document.getElementById('week-grid');
    labels.innerHTML = '';
    grid.innerHTML = '';
    for (let h = START_HOUR; h <= END_HOUR; h++) {
        const label = document.createElement('div');
        label.className = 'time-label';
        label.textContent = `${String(h).padStart(2, '0')}:00`;
        labels.appendChild(label);
    }
    for (let day = 0; day < 7; day++) {
        const column = document.createElement('div');
        column.className = 'day-column';
        const date = new Date(state.currentMonday);
        date.setDate(date.getDate() + day);
        const dateKey = formatDateKey(date);
        for (let h = START_HOUR; h <= END_HOUR; h++) {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.addEventListener('click', () => {
                const time = `${String(h).padStart(2, '0')}:00`;
                if (state.isMoving) moveLessonTo(dateKey, time);
                else openAddModal(dateKey, time);
            });
            column.appendChild(slot);
        }
        grid.appendChild(column);
    }
}

function renderEvents() {
    const layer = document.getElementById('events-layer');
    layer.innerHTML = '';
    const colWidth = layer.clientWidth / 7;
    for (let day = 0; day < 7; day++) {
        const d = new Date(state.currentMonday);
        d.setDate(d.getDate() + day);
        const dateKey = formatDateKey(d);
        (state.schedule[dateKey] || []).forEach(lesson => {
            const [hour, minute] = String(lesson.time || '00:00').split(':').map(Number);
            if (hour < START_HOUR || hour > END_HOUR) return;
            const card = document.createElement('div');
            const active = state.isMoving && state.selectedLesson && state.selectedLesson.id === lesson.id;
            card.className = `event-card color-${lessonColor(lesson.student)} ${active ? 'moving-active' : ''}`;
            card.style.top = `${((hour - START_HOUR) * 60 + minute) * HOUR_HEIGHT / 60}px`;
            card.style.left = `${day * colWidth + 2}px`;
            card.style.width = `${Math.max(20, colWidth - 4)}px`;
            card.style.height = `${HOUR_HEIGHT - 8}px`;
            card.innerHTML = `<div class="event-title"></div><div class="event-time"></div>`;
            card.querySelector('.event-title').textContent = lesson.student || 'Ученик';
            card.querySelector('.event-time').textContent = lesson.time;
            
            let timer;
            let longPressed = false;
            card.addEventListener('touchstart', () => {
                longPressed = false;
                timer = setTimeout(() => {
                    longPressed = true;
                    haptic('heavy');
                    openEditModal(dateKey, lesson);
                }, 500);
            }, { passive: true });
            card.addEventListener('touchend', () => clearTimeout(timer));
            card.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
            card.addEventListener('click', event => {
                event.stopPropagation();
                if (longPressed) return;
                if (state.isMoving) return;
                state.selectedLesson = { date: dateKey, ...lesson };
                state.isMoving = true;
                haptic('medium');
                document.getElementById('move-hint').classList.remove('hidden');
                renderEvents();
            });
            layer.appendChild(card);
        });
    }
}

function renderCalendar() {
    renderHeader();
    renderGrid();
    renderEvents();
}

function openAddModal(date, time) {
    state.selectedLesson = null;
    document.getElementById('modal-title').textContent = 'Добавить занятие';
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = time;
    document.getElementById('student-name').value = '';
    document.getElementById('edit-actions').classList.add('hidden');
    document.getElementById('btn-save').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEditModal(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    document.getElementById('modal-title').textContent = 'Занятие';
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = lesson.time || '';
    document.getElementById('student-name').value = lesson.student || '';
    document.getElementById('edit-actions').classList.remove('hidden');
    document.getElementById('btn-save').classList.add('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

async function saveLesson() {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    const student = document.getElementById('student-name').value.trim();
    if (!date || !time || !student) return alert('Заполните дату, время и имя ученика');
    try {
        const response = await fetch(`${API_URL}/add_lesson`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ date, time, student, user_id: user.id })
        });
        const data = await response.json();
        if (data.status !== 'ok') return alert(data.message || 'Ошибка сохранения');
        closeModal();
        fetchWeekSchedule();
    } catch (e) { alert('Ошибка сети'); }
}

async function deleteSelected() {
    if (!state.selectedLesson || !confirm('Удалить занятие?')) return;
    await fetch(`${API_URL}/delete_lesson`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({date:state.selectedLesson.date, time:state.selectedLesson.time})
    });
    closeModal();
    fetchWeekSchedule();
}

async function moveLessonTo(date, time) {
    if (!state.selectedLesson) return;
    const old = state.selectedLesson;
    try {
        await fetch(`${API_URL}/delete_lesson`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({date:old.date, time:old.time})
        });
        await fetch(`${API_URL}/add_lesson`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({date, time, student:old.student, student_id:old.student_id})
        });
        cancelMove();
        fetchWeekSchedule();
    } catch (e) { alert('Не удалось перенести занятие'); }
}

function cancelMove() {
    state.isMoving = false;
    state.selectedLesson = null;
    document.getElementById('move-hint').classList.add('hidden');
    renderEvents();
}

// Event listeners
document.getElementById('close-modal')?.addEventListener('click', closeModal);
document.getElementById('btn-save').addEventListener('click', saveLesson);
document.getElementById('btn-delete').addEventListener('click', deleteSelected);
document.getElementById('btn-prev-week').addEventListener('click', () => { state.currentMonday.setDate(state.currentMonday.getDate()-7); fetchWeekSchedule(); });
document.getElementById('btn-next-week').addEventListener('click', () => { state.currentMonday.setDate(state.currentMonday.getDate()+7); fetchWeekSchedule(); });
document.getElementById('btn-today').addEventListener('click', () => { state.currentMonday = getMonday(new Date()); fetchWeekSchedule(); });
document.getElementById('btn-chat').addEventListener('click', () => {
    const id = state.selectedLesson?.student_id;
    if (id && !String(id).startsWith('manual')) tg.openTelegramLink(`tg://user?id=${id}`);
    else alert('У ученика нет Telegram ID');
});
window.addEventListener('resize', renderEvents);

fetchStudents();
fetchWeekSchedule();