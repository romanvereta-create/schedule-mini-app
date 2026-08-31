const tg = window.Telegram.WebApp;
tg.expand();
const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
const START_HOUR = 6;
const END_HOUR = 23;
let hourHeight = 80;

const state = {
    currentMonday: getMonday(new Date()),
    schedule: {},
    students: {},
    selectedLesson: null,
    isMoving: false,
    pendingMove: null // { newDate, newTime }
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

function colorOf(name) { 
    let n=0; 
    for (const c of String(name||'')) n=((n<<5)-n)+c.charCodeAt(0); 
    return Math.abs(n)%8; 
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
        opt.dataset.phone = s.parent_phone || '';
        select.appendChild(opt);
    });
}

function renderCalendar() {
    const labels = document.getElementById('time-labels');
    const grid = document.getElementById('week-grid');
    const layer = document.getElementById('events-layer');
    
    labels.innerHTML = ''; 
    grid.innerHTML = ''; 
    layer.innerHTML = '';
    
    document.documentElement.style.setProperty('--hour-height', `${hourHeight}px`);
    
    // МЕСЯЦ В ШАПКЕ
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
            
            let paidClass = lesson.paid ? ' paid-status' : '';
            card.className = `event-card color-${colorOf(lesson.student)} ${active ? 'moving-active' : ''}${paidClass}`;
            
            // Точный расчет высоты и положения по минутам
            const topPx = ((h - START_HOUR) * 60 + m) * (hourHeight / 60);
            const heightPx = Math.max(22, duration * (hourHeight / 60) - 2);
            
            card.style.top = `${topPx}px`;
            card.style.left = `${d * colWidth + 2}px`;
            card.style.width = `${Math.max(20, colWidth - 4)}px`;
            card.style.height = `${heightPx}px`;
            
            card.innerHTML = `<div class="event-title"></div><div class="event-time"></div>`;
            card.querySelector('.event-title').textContent = lesson.student || 'Ученик';
            card.querySelector('.event-time').textContent = `${lesson.time} (${duration}м)`;
            
            let timer = null, longPressed = false;
            
            // Длинное нажатие (500мс) -> АКТИВИРУЕТ РЕЖИМ ПЕРЕНОСА!
            card.addEventListener('touchstart', () => {
                longPressed = false;
                timer = setTimeout(() => {
                    longPressed = true;
                    haptic('heavy');
                    state.selectedLesson = { date: key, ...lesson };
                    state.isMoving = true;
                    document.getElementById('move-hint').classList.remove('hidden');
                    renderCalendar();
                }, 500);
            }, {passive:true});
            
            card.addEventListener('touchmove', () => {
                clearTimeout(timer);
            }, {passive:true});
            
            card.addEventListener('touchend', () => clearTimeout(timer));
            
            // Обработка клика
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                if (longPressed || state.isMoving) return;
                
                // КОРОТКИЙ КЛИК -> Открывает Меню Действий!
                haptic('light');
                openActionMenu(key, lesson);
            });
            
            // Для Desktop: правый клик открывает контекстное меню (Action Menu)
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                haptic('medium');
                openActionMenu(key, lesson);
            });
            
            layer.appendChild(card);
        });
    }
}

// ============================================================
// МЕНЮ ДЕЙСТВИЙ (по короткому клику)
// ============================================================
function openActionMenu(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    document.getElementById('action-menu-title').textContent = lesson.student || 'Ученик';
    
    const paidBtn = document.getElementById('btn-action-paid');
    if (lesson.paid) {
        paidBtn.textContent = '✅ Оплачено (Отменить)';
    } else {
        paidBtn.textContent = '💳 Оплатил';
    }
    
    document.getElementById('action-menu-overlay').classList.remove('hidden');
}

function closeActionMenu() {
    document.getElementById('action-menu-overlay').classList.add('hidden');
}

// Написать ученику
document.getElementById('btn-action-chat-student').onclick = () => {
    const id = state.selectedLesson?.student_id;
    let username = '';
    if (id && state.students[id]) {
        username = state.students[id].username || '';
    }
    
    if (username) {
        tg.openTelegramLink(`https://t.me/${username}`);
    } else if (id && !String(id).startsWith('manual')) {
        tg.openTelegramLink(`tg://user?id=${id}`);
    } else {
        alert('У этого ученика нет сохранённого Telegram профиля.');
    }
    closeActionMenu();
};

// Написать родителю
document.getElementById('btn-action-chat-parent').onclick = () => {
    const l = state.selectedLesson;
    let phone = l?.parent_phone || '';
    if (!phone && l?.student_id && state.students[l.student_id]) {
        phone = state.students[l.student_id].parent_phone || '';
    }
    
    if (phone) {
        // Очищаем телефон для ссылки
        const cleanPhone = phone.replace(/[^0-9+]/g, '');
        window.open(`https://wa.me/${cleanPhone.replace('+', '')}`, '_blank');
    } else {
        const inputPhone = prompt('Введите номер телефона родителя (для WhatsApp/Telegram):');
        if (inputPhone) {
            const clean = inputPhone.replace(/[^0-9+]/g, '');
            window.open(`https://wa.me/${clean.replace('+', '')}`, '_blank');
        }
    }
    closeActionMenu();
};

// Отметка "Оплатил"
document.getElementById('btn-action-paid').onclick = async () => {
    if (!state.selectedLesson) return;
    const newPaidStatus = !state.selectedLesson.paid;
    
    try {
        await fetch(`${API_URL}/mark_paid`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                date: state.selectedLesson.date,
                id: state.selectedLesson.id,
                paid: newPaidStatus
            })
        });
        haptic('medium');
    } catch(e) {
        console.error(e);
    }
    closeActionMenu();
    fetchData();
};

// Кнопка Настройки из меню
document.getElementById('btn-action-settings').onclick = () => {
    closeActionMenu();
    if (state.selectedLesson) {
        openEditModal(state.selectedLesson.date, state.selectedLesson);
    }
};

// Кнопка Удалить из меню
document.getElementById('btn-action-delete').onclick = () => {
    closeActionMenu();
    document.getElementById('delete-modal-overlay').classList.remove('hidden');
};

document.getElementById('btn-action-close').onclick = closeActionMenu;
document.getElementById('action-menu-overlay').onclick = (e) => {
    if (e.target.id === 'action-menu-overlay') closeActionMenu();
};

// ============================================================
// ДИАЛОГ УДАЛЕНИЯ (Разово или все будущие)
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
// ПЕРЕНОС / ДОБАВЛЕНИЕ (по длинному нажатию)
// ============================================================
function confirmMoveTarget(newDate, newTime) {
    state.pendingMove = { newDate, newTime };
    document.getElementById('move-modal-desc').textContent = `${state.selectedLesson.student}: выберите действие для ${newDate} в ${newTime}`;
    document.getElementById('move-modal-overlay').classList.remove('hidden');
}

async function executeMove(actionType) { // 'copy', 'move_once', 'move_all'
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
        if (data.status !== 'ok') alert(data.message || 'Ошибка выполнения');
    } catch(e) {
        alert('Ошибка сети при переносе/копировании');
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
    document.getElementById('modal-title').textContent = 'Добавить занятие';
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = time;
    document.getElementById('lesson-duration').value = '60';
    document.getElementById('lesson-price').value = '';
    document.getElementById('lesson-id').value = '';
    document.getElementById('parent-phone').value = '';
    document.getElementById('repeat-group').classList.remove('hidden');
    resetForm();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEditModal(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    document.getElementById('modal-title').textContent = 'Настройки занятия';
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = lesson.time || '';
    document.getElementById('lesson-duration').value = lesson.duration || 60;
    document.getElementById('lesson-price').value = lesson.price || '';
    document.getElementById('lesson-id').value = lesson.id || '';
    document.getElementById('parent-phone').value = lesson.parent_phone || '';
    
    let found = false;
    const studentSel = document.getElementById('student-select');
    for (const o of studentSel.options) {
        if (o.value === lesson.student_id || o.dataset.name === lesson.student) {
            studentSel.value = o.value;
            found = true;
            break;
        }
    }
    if (!found) {
        studentSel.value = 'manual';
        document.getElementById('manual-student-name').value = lesson.student || '';
        document.getElementById('manual-student-name').classList.remove('hidden');
    } else {
        document.getElementById('manual-student-name').classList.add('hidden');
    }
    
    document.getElementById('reminder-minutes').value = lesson.reminder_minutes ?? 60;
    document.getElementById('reminder-text').value = lesson.reminder_text || '';
    document.getElementById('zoom-link').value = lesson.zoom_link || '';
    
    document.getElementById('repeat-group').classList.add('hidden');
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
}

async function saveLesson() {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    const duration = document.getElementById('lesson-duration').value;
    const price = document.getElementById('lesson-price').value;
    const parentPhone = document.getElementById('parent-phone').value.trim();
    const sel = document.getElementById('student-select');
    
    let student = '', studentId = '';
    if (sel.value === 'manual') {
        student = document.getElementById('manual-student-name').value.trim();
    } else if (sel.value) {
        student = sel.options[sel.selectedIndex].dataset.name || sel.options[sel.selectedIndex].textContent;
        studentId = sel.value;
    }
    
    if (!student || !time) return alert('Укажите имя ученика и время');
    
    const payload = {
        date, time, duration: parseInt(duration || 60), student, student_id: studentId,
        price, parent_phone: parentPhone,
        reminder_minutes: document.getElementById('reminder-minutes').value,
        reminder_text: document.getElementById('reminder-text').value,
        zoom_link: document.getElementById('zoom-link').value,
        repeat: document.getElementById('lesson-repeat').value
    };
    
    let url = '/add_lesson';
    if (state.selectedLesson && state.selectedLesson.id) {
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
// ПЛАВНЫЙ ЗУМ ДВУМЯ ПАЛЬЦАМИ (PINCH ZOOM BY VERTICAL PROJECTION)
// ============================================================
let initialPinchDistY = 0;
let initialHourHeight = hourHeight;
const calContainer = document.getElementById('calendar-container');

calContainer.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
        // Проекция ТОЛЬКО по Y (вертикали)
        initialPinchDistY = Math.abs(e.touches[0].clientY - e.touches[1].clientY);
        initialHourHeight = hourHeight;
    }
}, {passive:true});

calContainer.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
        e.preventDefault(); // Предотвращаем стандартный скролл страницы
        const currentDistY = Math.abs(e.touches[0].clientY - e.touches[1].clientY);
        const deltaY = currentDistY - initialPinchDistY;
        
        // Меняем высоту часа на основе вертикальной проекции сжатия/разжатия
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
// ВЫБОР ДАТЫ / МЕСЯЦА
// ============================================================
const datePickerInput = document.getElementById('date-picker-input');
const monthLabel = document.getElementById('month-label');
const btnDatePicker = document.getElementById('btn-date-picker');

function triggerDatePicker() {
    datePickerInput.showPicker ? datePickerInput.showPicker() : datePickerInput.click();
}

monthLabel.onclick = triggerDatePicker;
btnDatePicker.onclick = triggerDatePicker;

datePickerInput.onchange = (e) => {
    const val = e.target.value;
    if (val) {
        const [y, m, d] = val.split('-').map(Number);
        const selectedDate = new Date(y, m - 1, d);
        state.currentMonday = getMonday(selectedDate);
        fetchData();
    }
};

// Слушатели кнопок
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
