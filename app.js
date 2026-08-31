const tg = window.Telegram.WebApp;
tg.expand();
const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
const START_HOUR = 6;
const END_HOUR = 23;

const ZOOM_LEVELS = [50, 80, 120];
let currentZoomIdx = 1; // По умолчанию 80px
let hourHeight = ZOOM_LEVELS[currentZoomIdx];

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
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    d.setHours(0,0,0,0);
    return d;
}

function dateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function haptic(type='light') { 
    try { tg.HapticFeedback.impactOccurred(type); } catch(e) {} 
}

function colorOf(studentId, name) {
    let sObj = state.students[studentId];
    if (sObj && typeof sObj === 'object' && sObj.color !== undefined) {
        return sObj.color;
    }
    let n = 0; 
    for (const c of String(name||'')) n = ((n<<5)-n) + c.charCodeAt(0); 
    return Math.abs(n) % 8; 
}

async function fetchData() {
    try {
        const scheduleResponse = await fetch(`${API_URL}/get_week_schedule`, { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({week_start:dateKey(state.currentMonday)}) 
        });
        const scheduleData = await scheduleResponse.json();
        if (scheduleData.status !== 'ok') throw new Error(scheduleData.message || 'Ошибка расписания');
        state.schedule = scheduleData.schedule || {};
        
        const studentsResponse = await fetch(`${API_URL}/get_students`);
        const studentsData = await studentsResponse.json();
        state.students = studentsData.students || {};
        
        fillStudentsDropdown();
        renderCalendar();
    } catch(e) { 
        console.error(e); 
        alert('Не удалось загрузить данные'); 
    }
}

function fillStudentsDropdown() {
    const select = document.getElementById('student-select');
    select.innerHTML = '<option value="">-- Выбрать ученика --</option><option value="manual">Вписать вручную...</option>';
    Object.entries(state.students).forEach(([id, item]) => {
        const s = typeof item === 'string' ? {name:item, user_id:id} : item;
        const opt = document.createElement('option'); 
        opt.value = id; 
        opt.textContent = s.name || id; 
        opt.dataset.name = s.name || id; 
        opt.dataset.username = s.username || ''; 
        opt.dataset.contact = s.parent_contact || '';
        opt.dataset.contactType = s.parent_contact_type || 'tg';
        select.appendChild(opt);
    });
}

function renderCalendar() {
    const labels = document.getElementById('time-labels');
    const grid = document.getElementById('week-grid');
    const layer = document.getElementById('events-layer');
    
    labels.innerHTML = ''; 
    grid.innerHTML = ''; 
    
    // Удаляем старые карточки (не удаляя полоску времени)
    const oldCards = layer.querySelectorAll('.event-card');
    oldCards.forEach(c => c.remove());
    
    document.documentElement.style.setProperty('--hour-height', `${hourHeight}px`);
    
    const midWeek = new Date(state.currentMonday);
    midWeek.setDate(midWeek.getDate() + 3);
    document.getElementById('month-label').textContent = midWeek.toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
    
    const today = dateKey(new Date()); 
    const header = document.getElementById('days-header'); 
    header.innerHTML = '';
    
    for (let d = 0; d < 7; d++) { 
        const dt = new Date(state.currentMonday); 
        dt.setDate(dt.getDate() + d); 
        const c = document.createElement('div'); 
        c.className = 'day-header-cell ' + (dateKey(dt) === today ? 'today' : ''); 
        c.innerHTML = `<div>${['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'][d]}</div><div class="day-num">${dt.getDate()}</div>`; 
        header.appendChild(c); 
    }
    
    for (let h = START_HOUR; h <= END_HOUR; h++) {
        const l = document.createElement('div');
        l.className = 'time-label';
        l.style.height = hourHeight + 'px';
        l.textContent = String(h).padStart(2,'0') + ':00';
        labels.appendChild(l);
    }
    
    for (let d = 0; d < 7; d++) {
        const col = document.createElement('div');
        col.className = 'day-column';
        const dt = new Date(state.currentMonday); 
        dt.setDate(dt.getDate() + d);
        const key = dateKey(dt);
        
        for (let h = START_HOUR; h <= END_HOUR; h++) {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.style.height = hourHeight + 'px';
            
            slot.onclick = () => { 
                const slotTime = `${String(h).padStart(2,'0')}:00`;
                if (state.isMoving) {
                    confirmMoveTarget(key, slotTime);
                } else {
                    openAddModal(key, slotTime);
                }
            };
            col.appendChild(slot);
        }
        grid.appendChild(col);
    }
    renderEvents();
    updateCurrentTimeLine();
}

function renderEvents() {
    const layer = document.getElementById('events-layer');
    const colWidth = layer.clientWidth / 7;
    
    for (let d = 0; d < 7; d++) {
        const dt = new Date(state.currentMonday); 
        dt.setDate(dt.getDate() + d);
        const key = dateKey(dt);
        
        (state.schedule[key] || []).forEach(lesson => {
            const timeStr = String(lesson.time || '00:00');
            const [h, m] = timeStr.split(':').map(Number);
            if (h < START_HOUR || h > END_HOUR) return;
            
            const duration = parseInt(lesson.duration || 60);
            const card = document.createElement('div');
            const active = state.isMoving && state.selectedLesson && state.selectedLesson.id === lesson.id;
            
            const colorClass = `color-${colorOf(lesson.student_id, lesson.student)}`;
            card.className = `event-card ${colorClass} ${active ? 'moving-active' : ''}`;
            
            const topPx = ((h - START_HOUR) * 60 + m) * (hourHeight / 60);
            const heightPx = Math.max(22, duration * (hourHeight / 60) - 2);
            
            card.style.top = `${topPx}px`;
            card.style.left = `${d * colWidth + 2}px`;
            card.style.width = `${Math.max(20, colWidth - 4)}px`;
            card.style.height = `${heightPx}px`;
            
            let paidBadge = lesson.paid ? `<div class="paid-badge">ОПЛАЧЕНО</div>` : '';
            card.innerHTML = `${paidBadge}<div class="event-title"></div><div class="event-time"></div>`;
            card.querySelector('.event-title').textContent = lesson.student || 'Ученик';
            card.querySelector('.event-time').textContent = `${lesson.time} (${duration}м)`;
            
            let timer = null, longPressed = false;
            
            // Длинное нажатие -> Режим переноса
            card.addEventListener('touchstart', () => {
                longPressed = false;
                timer = setTimeout(() => {
                    longPressed = true;
                    haptic('heavy');
                    triggerMoveFromLesson(key, lesson);
                }, 500);
            }, {passive:true});
            
            card.addEventListener('touchmove', () => clearTimeout(timer), {passive:true});
            card.addEventListener('touchend', () => clearTimeout(timer));
            
            // Короткий клик -> Открывает Меню Действий!
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                if (longPressed || state.isMoving) return;
                haptic('light');
                openActionMenu(key, lesson);
            });
            
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                haptic('medium');
                openActionMenu(key, lesson);
            });
            
            layer.appendChild(card);
        });
    }
}

// Зелёная линия текущего времени
function updateCurrentTimeLine() {
    const line = document.getElementById('current-time-line');
    const now = new Date();
    const todayKey = dateKey(now);
    
    // Проверяем, отображается ли текущая неделя
    let todayColIndex = -1;
    for (let d = 0; d < 7; d++) {
        const dt = new Date(state.currentMonday);
        dt.setDate(dt.getDate() + d);
        if (dateKey(dt) === todayKey) {
            todayColIndex = d;
            break;
        }
    }
    
    if (todayColIndex === -1) {
        line.classList.add('hidden');
        return;
    }
    
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    
    if (currentHour < START_HOUR || currentHour > END_HOUR) {
        line.classList.add('hidden');
        return;
    }
    
    const layer = document.getElementById('events-layer');
    const colWidth = layer.clientWidth / 7;
    const topPx = ((currentHour - START_HOUR) * 60 + currentMin) * (hourHeight / 60);
    
    line.style.top = `${topPx}px`;
    line.style.left = `${todayColIndex * colWidth}px`;
    line.style.width = `${colWidth}px`;
    line.classList.remove('hidden');
}

// Повторяем обновление линии каждые 5 минут
setInterval(updateCurrentTimeLine, 5 * 60 * 1000);

// ============================================================
// МЕНЮ ДЕЙСТВИЙ
// ============================================================
function openActionMenu(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    document.getElementById('action-menu-title').textContent = lesson.student || 'Ученик';
    
    const paidBtn = document.getElementById('btn-action-paid');
    paidBtn.textContent = lesson.paid ? '✅ Оплачено (Снять)' : '💳 Оплатил';
    
    document.getElementById('action-menu-overlay').classList.remove('hidden');
}

function closeActionMenu() {
    document.getElementById('action-menu-overlay').classList.add('hidden');
}

function triggerMoveFromLesson(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    state.isMoving = true;
    document.getElementById('move-hint').classList.remove('hidden');
    haptic('medium');
    renderCalendar();
}

document.getElementById('btn-action-move-trigger').onclick = () => {
    closeActionMenu();
    if (state.selectedLesson) {
        triggerMoveFromLesson(state.selectedLesson.date, state.selectedLesson);
    }
};

document.getElementById('btn-action-chat-student').onclick = () => {
    const id = state.selectedLesson?.student_id;
    let username = state.students[id]?.username || '';
    if (username) {
        tg.openTelegramLink(`https://t.me/${username}`);
    } else if (id && !String(id).startsWith('manual')) {
        tg.openTelegramLink(`tg://user?id=${id}`);
    } else {
        alert('У этого ученика нет сохранённого профиля Telegram');
    }
    closeActionMenu();
};

document.getElementById('btn-action-chat-parent').onclick = () => {
    const l = state.selectedLesson;
    let contact = l?.parent_contact || '';
    let type = l?.parent_contact_type || 'tg';
    
    if (!contact && l?.student_id && state.students[l.student_id]) {
        contact = state.students[l.student_id].parent_contact || '';
        type = state.students[l.student_id].parent_contact_type || 'tg';
    }
    
    if (contact) {
        if (type === 'tg') {
            const cleanTg = contact.replace('@', '').trim();
            tg.openTelegramLink(`https://t.me/${cleanTg}`);
        } else if (type === 'wa') {
            const clean = contact.replace(/[^0-9]/g, '');
            window.open(`https://wa.me/${clean}`, '_blank');
        } else {
            alert(`Контакт родителя (${type}): ${contact}`);
        }
    } else {
        alert('Контакт родителя не указан в настройках.');
    }
    closeActionMenu();
};

document.getElementById('btn-action-paid').onclick = async () => {
    if (!state.selectedLesson) return;
    const newStatus = !state.selectedLesson.paid;
    try {
        await fetch(`${API_URL}/mark_paid`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                date: state.selectedLesson.date,
                id: state.selectedLesson.id,
                paid: newStatus
            })
        });
        haptic('medium');
    } catch(e) {}
    closeActionMenu();
    fetchData();
};

// Выбор цвета
document.getElementById('btn-action-color').onclick = () => {
    closeActionMenu();
    document.getElementById('color-modal-overlay').classList.remove('hidden');
};

document.querySelectorAll('.color-circle').forEach(el => {
    el.onclick = async () => {
        const colorIdx = parseInt(el.dataset.color);
        const studentId = state.selectedLesson?.student_id;
        if (studentId) {
            try {
                await fetch(`${API_URL}/update_student_color`, {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ student_id: studentId, color: colorIdx })
                });
                haptic('medium');
            } catch(e) {}
        }
        document.getElementById('color-modal-overlay').classList.add('hidden');
        fetchData();
    };
});

document.getElementById('btn-color-close').onclick = () => {
    document.getElementById('color-modal-overlay').classList.add('hidden');
};

document.getElementById('btn-action-settings').onclick = () => {
    closeActionMenu();
    if (state.selectedLesson) {
        openEditModal(state.selectedLesson.date, state.selectedLesson);
    }
};

document.getElementById('btn-action-delete').onclick = () => {
    closeActionMenu();
    document.getElementById('delete-modal-overlay').classList.remove('hidden');
};

document.getElementById('btn-action-close').onclick = closeActionMenu;
document.getElementById('action-menu-overlay').onclick = (e) => {
    if (e.target.id === 'action-menu-overlay') closeActionMenu();
};

// ============================================================
// ДИАЛОГ УДАЛЕНИЯ
// ============================================================
document.getElementById('btn-delete-once').onclick = async () => {
    if (!state.selectedLesson) return;
    await fetch(`${API_URL}/delete_lesson`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ date: state.selectedLesson.date, id: state.selectedLesson.id, delete_all: false })
    });
    document.getElementById('delete-modal-overlay').classList.add('hidden');
    fetchData();
};

document.getElementById('btn-delete-all').onclick = async () => {
    if (!state.selectedLesson) return;
    await fetch(`${API_URL}/delete_lesson`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ date: state.selectedLesson.date, id: state.selectedLesson.id, delete_all: true })
    });
    document.getElementById('delete-modal-overlay').classList.add('hidden');
    fetchData();
};

document.getElementById('btn-delete-cancel').onclick = () => {
    document.getElementById('delete-modal-overlay').classList.add('hidden');
};

// ============================================================
// ПЕРЕНОС / КОПИРОВАНИЕ
// ============================================================
function confirmMoveTarget(newDate, newTime) {
    state.pendingMove = { newDate, newTime };
    document.getElementById('move-modal-desc').textContent = `${state.selectedLesson.student}: выберите действие для ${newDate} в ${newTime}`;
    document.getElementById('move-modal-overlay').classList.remove('hidden');
}

async function executeMove(actionType) {
    if (!state.selectedLesson || !state.pendingMove) return;
    const { newDate, newTime } = state.pendingMove;
    
    try {
        const res = await fetch(`${API_URL}/move_lesson`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                old_date: state.selectedLesson.date,
                id: state.selectedLesson.id,
                new_date: newDate,
                new_time: newTime,
                action_type: actionType
            })
        });
        const data = await res.json();
        if (data.status !== 'ok') alert(data.message || 'Ошибка');
    } catch(e) {
        alert('Ошибка связи при переносе');
    }
    
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

document.getElementById('btn-action-copy').onclick = () => executeMove('copy');
document.getElementById('btn-action-move-once').onclick = () => executeMove('move_once');
document.getElementById('btn-action-move-all').onclick = () => executeMove('move_all');
document.getElementById('btn-action-move-cancel').onclick = cancelMove;
document.getElementById('btn-cancel-move').onclick = cancelMove;

// ============================================================
// МОДАЛЬНОЕ ОКНО НАСТРОЕК / ДОБАВЛЕНИЯ
// ============================================================
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
    document.getElementById('lesson-id').value = '';
    document.getElementById('parent-contact').value = '';
    document.getElementById('parent-contact-type').value = 'tg';
    
    resetForm();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEditModal(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    state.editingExisting = true;
    document.getElementById('modal-title').textContent = 'Настройки ученика';
    
    document.getElementById('student-select-group').classList.add('hidden');
    document.getElementById('student-fixed-group').classList.remove('hidden');
    document.getElementById('fixed-student-name').value = lesson.student || '';
    
    // В настройках НЕ показываем время и длительность!
    document.getElementById('time-duration-group').classList.add('hidden');
    document.getElementById('repeat-group').classList.add('hidden');
    
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = lesson.time || '10:00';
    document.getElementById('lesson-duration').value = lesson.duration || 60;
    document.getElementById('lesson-price').value = lesson.price || '';
    document.getElementById('lesson-id').value = lesson.id || '';
    
    let contact = lesson.parent_contact || '';
    let contactType = lesson.parent_contact_type || 'tg';
    if (!contact && lesson.student_id && state.students[lesson.student_id]) {
        contact = state.students[lesson.student_id].parent_contact || '';
        contactType = state.students[lesson.student_id].parent_contact_type || 'tg';
    }
    
    document.getElementById('parent-contact').value = contact;
    document.getElementById('parent-contact-type').value = contactType;
    document.getElementById('reminder-minutes').value = lesson.reminder_minutes ?? 60;
    document.getElementById('reminder-text').value = lesson.reminder_text || '';
    document.getElementById('zoom-link').value = lesson.zoom_link || '';
    
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function resetForm() {
    document.getElementById('student-select').value = '';
    document.getElementById('manual-student-name').value = '';
    document.getElementById('manual-student-name').classList.add('hidden');
    document.getElementById('reminder-minutes').value = '60';
    document.getElementById('reminder-text').value = '';
    document.getElementById('zoom-link').value = '';
    document.getElementById('lesson-repeat').value = 'no';
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('move-modal-overlay').classList.add('hidden');
    document.getElementById('action-menu-overlay').classList.add('hidden');
    document.getElementById('delete-modal-overlay').classList.add('hidden');
    document.getElementById('color-modal-overlay').classList.add('hidden');
}

async function saveLesson() {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    const duration = document.getElementById('lesson-duration').value;
    const price = document.getElementById('lesson-price').value;
    const parentContact = document.getElementById('parent-contact').value.trim();
    const parentContactType = document.getElementById('parent-contact-type').value;
    
    let student = '', studentId = '';
    
    if (state.editingExisting && state.selectedLesson) {
        student = state.selectedLesson.student;
        studentId = state.selectedLesson.student_id;
    } else {
        const sel = document.getElementById('student-select');
        if (sel.value === 'manual') {
            student = document.getElementById('manual-student-name').value.trim();
        } else if (sel.value) {
            student = sel.options[sel.selectedIndex].dataset.name || sel.options[sel.selectedIndex].textContent;
            studentId = sel.value;
        }
    }
    
    if (!student || !time) return alert('Укажите имя ученика');
    
    const payload = {
        date, time, duration: parseInt(duration || 60), student, student_id: studentId,
        price, parent_contact: parentContact, parent_contact_type: parentContactType,
        reminder_minutes: document.getElementById('reminder-minutes').value,
        reminder_text: document.getElementById('reminder-text').value,
        zoom_link: document.getElementById('zoom-link').value,
        repeat: document.getElementById('lesson-repeat').value
    };
    
    let url = '/add_lesson';
    if (state.editingExisting && state.selectedLesson) {
        url = '/update_lesson';
        payload.id = state.selectedLesson.id;
    }
    
    try {
        const res = await fetch(API_URL + url, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status !== 'ok') return alert(data.message || 'Ошибка сохранения');
        
        closeModal();
        fetchData();
    } catch(e) {
        alert('Ошибка сохранения');
    }
}

// ============================================================
// ЗУМ (ВЕРТИКАЛЬНЫЙ И КНОПКА 🔍)
// ============================================================
document.getElementById('btn-zoom-toggle').onclick = () => {
    currentZoomIdx = (currentZoomIdx + 1) % ZOOM_LEVELS.length;
    hourHeight = ZOOM_LEVELS[currentZoomIdx];
    renderCalendar();
};

let initialPinchDistY = 0;
let initialHourHeight = hourHeight;
const calContainer = document.getElementById('calendar-container');

calContainer.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
        initialPinchDistY = Math.abs(e.touches[0].clientY - e.touches[1].clientY);
        initialHourHeight = hourHeight;
    }
}, {passive:true});

calContainer.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
        e.preventDefault();
        const currentDistY = Math.abs(e.touches[0].clientY - e.touches[1].clientY);
        const deltaY = currentDistY - initialPinchDistY;
        hourHeight = Math.max(40, Math.min(160, initialHourHeight + deltaY * 0.6));
        renderCalendar();
    }
}, {passive:false});

calContainer.addEventListener('touchend', e => {
    if (e.touches.length < 2) {
        initialPinchDistY = 0;
    }
});

// ============================================================
// ВЫБОР ДАТЫ / СЕГОДНЯ
// ============================================================
const datePickerInput = document.getElementById('date-picker-input');
const monthLabel = document.getElementById('month-label');

monthLabel.onclick = () => {
    datePickerInput.showPicker ? datePickerInput.showPicker() : datePickerInput.click();
};

datePickerInput.onchange = (e) => {
    const val = e.target.value;
    if (val) {
        const [y, m, d] = val.split('-').map(Number);
        const selectedDate = new Date(y, m - 1, d);
        state.currentMonday = getMonday(selectedDate);
        fetchData();
    }
};

document.getElementById('btn-today').onclick = () => {
    state.currentMonday = getMonday(new Date());
    fetchData();
};

document.getElementById('student-select').onchange = e => {
    document.getElementById('manual-student-name').classList.toggle('hidden', e.target.value !== 'manual');
};

document.getElementById('btn-save').onclick = saveLesson;
document.getElementById('btn-cancel-modal').onclick = closeModal;
document.getElementById('btn-close-modal').onclick = closeModal;

document.getElementById('modal-overlay').onclick = e => { if (e.target.id === 'modal-overlay') closeModal(); };

document.getElementById('btn-prev-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate() - 7); fetchData(); };
document.getElementById('btn-next-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate() + 7); fetchData(); };

window.addEventListener('resize', renderEvents);

// Старт
fetchData();
