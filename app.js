// ============================================================
// TELEGRAM MINI APP INITIALIZATION
// ============================================================
const tg = window.Telegram.WebApp;
tg.expand();

let user = tg.initDataUnsafe?.user || { id: 380819371, first_name: 'Преподаватель' };
const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';

const state = {
    currentMonday: getMonday(new Date()),
    schedule: {},
    students: {},
    selectedLesson: null,
    isMoving: false
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function formatDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTH_NAMES = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];
const DAY_NAMES = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

// ============================================================
// API CALLS
// ============================================================
async function fetchWeekSchedule() {
    const weekStartKey = formatDateKey(state.currentMonday);
    try {
        const res = await fetch(`${API_URL}/get_week_schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week_start: weekStartKey })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            state.schedule = data.schedule || {};
            renderCalendar();
        }
    } catch (e) {
        console.error('Ошибка сети:', e);
    }
}

async function fetchStudents() {
    try {
        const res = await fetch(`${API_URL}/get_students`);
        const data = await res.json();
        if (data.status === 'ok') {
            state.students = data.students || {};
            populateStudentSelect();
        }
    } catch (e) {
        console.error('Ошибка загрузки учеников:', e);
    }
}

// ============================================================
// RENDERING GOOGLE CALENDAR UI
// ============================================================
function renderHeader() {
    const monthLabel = document.getElementById('month-label');
    const daysHeader = document.getElementById('days-header');
    
    // Month label
    const midWeek = new Date(state.currentMonday);
    midWeek.setDate(midWeek.getDate() + 3);
    monthLabel.textContent = `${MONTH_NAMES[midWeek.getMonth()]} ${midWeek.getFullYear()}`;
    
    // Days row
    daysHeader.innerHTML = '';
    const todayStr = formatDateKey(new Date());

    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(state.currentMonday);
        dayDate.setDate(dayDate.getDate() + i);
        const dateKey = formatDateKey(dayDate);
        const isToday = dateKey === todayStr;

        const cell = document.createElement('div');
        cell.className = `day-header-cell ${isToday ? 'today' : ''}`;
        cell.innerHTML = `
            <div>${DAY_NAMES[i]}</div>
            <div class="day-num">${dayDate.getDate()}</div>
        `;
        daysHeader.appendChild(cell);
    }
}

function renderGrid() {
    const timeLabels = document.getElementById('time-labels');
    const weekGrid = document.getElementById('week-grid');
    
    timeLabels.innerHTML = '';
    weekGrid.innerHTML = '';

    // Render hours 08:00 - 22:00
    for (let h = 8; h <= 22; h++) {
        const timeStr = `${String(h).padStart(2, '0')}:00`;
        const label = document.createElement('div');
        label.className = 'time-label';
        label.textContent = timeStr;
        timeLabels.appendChild(label);
    }

    // Render 7 day columns
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayCol = document.createElement('div');
        dayCol.className = 'day-column';
        dayCol.dataset.dayIndex = dayIndex;

        const dayDate = new Date(state.currentMonday);
        dayDate.setDate(dayDate.getDate() + dayIndex);
        const dateKey = formatDateKey(dayDate);

        for (let h = 8; h <= 22; h++) {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.dataset.date = dateKey;
            slot.dataset.hour = h;
            
            slot.addEventListener('click', () => {
                const timeStr = `${String(h).padStart(2, '0')}:00`;
                onSlotClick(dateKey, timeStr);
            });
            dayCol.appendChild(slot);
        }
        weekGrid.appendChild(dayCol);
    }
}

function renderEvents() {
    const layer = document.getElementById('events-layer');
    layer.innerHTML = '';

    const gridWidth = layer.clientWidth;
    const colWidth = gridWidth / 7;

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayDate = new Date(state.currentMonday);
        dayDate.setDate(dayDate.getDate() + dayIndex);
        const dateKey = formatDateKey(dayDate);
        const lessons = state.schedule[dateKey] || [];

        lessons.forEach(lesson => {
            if (!lesson.time) return;
            const [h, m] = lesson.time.split(':').map(Number);
            if (h < 8 || h > 22) return;

            // Compute Y position (1 hour = 80px)
            const minutesFrom8 = (h - 8) * 60 + m;
            const topPx = (minutesFrom8 / 60) * 80;
            const heightPx = 50; // default height for 45-60 min lesson

            const card = document.createElement('div');
            card.className = 'event-card color-1';
            card.style.top = `${topPx}px`;
            card.style.left = `${dayIndex * colWidth + 2}px`;
            card.style.width = `${colWidth - 4}px`;
            card.style.height = `${heightPx}px`;

            card.innerHTML = `
                <div class="event-title">${lesson.student}</div>
                <div class="event-time">${lesson.time}</div>
            `;

            card.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditModal(dateKey, lesson);
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

// ============================================================
// MODAL & INTERACTION
// ============================================================
const modalOverlay = document.getElementById('modal-overlay');
const studentSelect = document.getElementById('student-select');
const manualStudentInput = document.getElementById('manual-student-name');

function populateStudentSelect() {
    studentSelect.innerHTML = `
        <option value="">-- Выбрать из списка --</option>
        <option value="manual">Вписать вручную...</option>
    `;
    Object.values(state.students).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.user_id || s.name;
        opt.textContent = s.name;
        opt.dataset.username = s.username || '';
        opt.dataset.name = s.name;
        studentSelect.appendChild(opt);
    });
}

studentSelect.addEventListener('change', () => {
    if (studentSelect.value === 'manual') {
        manualStudentInput.classList.remove('hidden');
    } else {
        manualStudentInput.classList.add('hidden');
    }
});

function onSlotClick(dateKey, timeStr) {
    if (state.isMoving && state.selectedLesson) {
        // Move operation
        moveLessonTo(dateKey, timeStr);
        return;
    }

    // New Lesson Modal
    state.selectedLesson = null;
    document.getElementById('modal-title').textContent = 'Добавить занятие';
    document.getElementById('lesson-date').value = dateKey;
    document.getElementById('lesson-time').value = timeStr;
    document.getElementById('repeat-group').classList.remove('hidden');
    document.getElementById('edit-actions').classList.add('hidden');
    
    studentSelect.value = '';
    manualStudentInput.value = '';
    manualStudentInput.classList.add('hidden');
    document.getElementById('zoom-link').value = '';
    document.getElementById('lesson-text').value = '';

    modalOverlay.classList.remove('hidden');
}

function openEditModal(dateKey, lesson) {
    state.selectedLesson = { date: dateKey, ...lesson };
    document.getElementById('modal-title').textContent = 'Редактировать занятие';
    document.getElementById('lesson-date').value = dateKey;
    document.getElementById('lesson-time').value = lesson.time;
    document.getElementById('repeat-group').classList.add('hidden');
    document.getElementById('edit-actions').classList.remove('hidden');

    // Find student in dropdown
    let found = false;
    for (let opt of studentSelect.options) {
        if (opt.dataset.name === lesson.student || opt.value === lesson.student_id) {
            studentSelect.value = opt.value;
            found = true;
            break;
        }
    }
    if (!found) {
        studentSelect.value = 'manual';
        manualStudentInput.value = lesson.student;
        manualStudentInput.classList.remove('hidden');
    } else {
        manualStudentInput.classList.add('hidden');
    }

    document.getElementById('reminder-minutes').value = lesson.reminder_minutes || 60;
    document.getElementById('zoom-link').value = lesson.zoom_link || '';
    document.getElementById('lesson-text').value = lesson.reminder_text || '';

    modalOverlay.classList.remove('hidden');
}

document.getElementById('close-modal').addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
});

document.getElementById('btn-save').addEventListener('click', async () => {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    
    let studentName = '';
    let studentId = '';
    
    if (studentSelect.value === 'manual') {
        studentName = manualStudentInput.value.trim();
    } else if (studentSelect.value) {
        const selectedOpt = studentSelect.options[studentSelect.selectedIndex];
        studentName = selectedOpt.dataset.name || selectedOpt.textContent;
        studentId = selectedOpt.value;
    }

    if (!studentName || !time) {
        alert('Заполните имя и время');
        return;
    }

    const payload = {
        date,
        time,
        student: studentName,
        student_id: studentId,
        reminder_minutes: document.getElementById('reminder-minutes').value,
        zoom_link: document.getElementById('zoom-link').value,
        reminder_text: document.getElementById('lesson-text').value,
        repeat: document.getElementById('lesson-repeat').value
    };

    const endpoint = state.selectedLesson ? '/update_lesson' : '/add_lesson';
    if (state.selectedLesson) {
        payload.old_time = state.selectedLesson.time;
    }

    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'ok') {
            modalOverlay.classList.add('hidden');
            fetchWeekSchedule();
        } else {
            alert(data.message || 'Ошибка сохранения');
        }
    } catch (e) {
        alert('Ошибка сети');
    }
});

document.getElementById('btn-delete').addEventListener('click', async () => {
    if (!state.selectedLesson) return;
    if (!confirm('Удалить занятие?')) return;

    try {
        const res = await fetch(`${API_URL}/delete_lesson`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: state.selectedLesson.date,
                time: state.selectedLesson.time
            })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            modalOverlay.classList.add('hidden');
            fetchWeekSchedule();
        }
    } catch (e) {
        alert('Ошибка удаления');
    }
});

document.getElementById('btn-chat').addEventListener('click', () => {
    if (!state.selectedLesson) return;
    const studentId = state.selectedLesson.student_id;
    
    let studentObj = state.students[studentId];
    if (studentObj && studentObj.username) {
        tg.openTelegramLink(`https://t.me/${studentObj.username}`);
    } else if (studentId && !studentId.startsWith('manual')) {
        tg.openTelegramLink(`tg://user?id=${studentId}`);
    } else {
        alert('У этого ученика нет привязанного Telegram профиля.');
    }
});

document.getElementById('btn-move').addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
    state.isMoving = true;
    alert('Кликните по новому слоту в календаре, чтобы перенести занятие туда.');
});

async function moveLessonTo(newDate, newTime) {
    if (!state.selectedLesson) return;
    
    // Delete old
    await fetch(`${API_URL}/delete_lesson`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            date: state.selectedLesson.date,
            time: state.selectedLesson.time
        })
    });

    // Add new
    await fetch(`${API_URL}/add_lesson`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            date: newDate,
            time: newTime,
            student: state.selectedLesson.student,
            student_id: state.selectedLesson.student_id,
            reminder_minutes: state.selectedLesson.reminder_minutes,
            zoom_link: state.selectedLesson.zoom_link,
            reminder_text: state.selectedLesson.reminder_text
        })
    });

    state.isMoving = false;
    state.selectedLesson = null;
    fetchWeekSchedule();
}

// ============================================================
// INITIALIZATION & LISTENERS
// ============================================================
document.getElementById('btn-prev-week').addEventListener('click', () => {
    state.currentMonday.setDate(state.currentMonday.getDate() - 7);
    fetchWeekSchedule();
});

document.getElementById('btn-next-week').addEventListener('click', () => {
    state.currentMonday.setDate(state.currentMonday.getDate() + 7);
    fetchWeekSchedule();
});

document.getElementById('btn-today').addEventListener('click', () => {
    state.currentMonday = getMonday(new Date());
    fetchWeekSchedule();
});

document.getElementById('btn-refresh').addEventListener('click', () => {
    fetchWeekSchedule();
    fetchStudents();
});

window.addEventListener('resize', renderEvents);

// Boot
fetchStudents();
fetchWeekSchedule();
