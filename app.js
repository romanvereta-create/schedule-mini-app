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
    pendingMove: null // Хранит { newDate, newTime }
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
        
        fillStudents();
        renderCalendar();
    } catch(e) { 
        console.error(e); 
        alert('Не удалось загрузить данные'); 
    }
}

function fillStudents() {
    const select = document.getElementById('student-select');
    select.innerHTML = '<option value="">-- Выбрать ученика --</option><option value="manual">Вписать вручную...</option>';
    Object.entries(state.students).forEach(([id, item]) => {
        const s = typeof item === 'string' ? {name:item, user_id:id} : item;
        const opt = document.createElement('option'); 
        opt.value = id; 
        opt.textContent = s.name || id; 
        opt.dataset.name = s.name || id; 
        opt.dataset.username = s.username || ''; 
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
    document.getElementById('month-label').textContent = state.currentMonday.toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
    
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
                    confirmMove(key, slotTime);
                } else {
                    openAdd(key, slotTime);
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
            card.className = `event-card color-${colorOf(lesson.student)} ${active ? 'moving-active' : ''}`;
            
            // Пропорциональный расчет высоты и положения по минутам
            const topPx = ((h - START_HOUR) * 60 + m) * (hourHeight / 60);
            const heightPx = Math.max(22, duration * (hourHeight / 60) - 2);
            
            card.style.top = `${topPx}px`;
            card.style.left = `${d * colWidth + 2}px`;
            card.style.width = `${Math.max(20, colWidth - 4)}px`;
            card.style.height = `${heightPx}px`;
            
            card.innerHTML = `<div class="event-title"></div><div class="event-time"></div>`;
            card.querySelector('.event-title').textContent = lesson.student || 'Ученик';
            card.querySelector('.event-time').textContent = `${lesson.time} (${duration}м)`;
            
            let timer = null, moved = false;
            
            // Обработка Long Press (долгое нажатие 500мс)
            card.addEventListener('touchstart', () => {
                moved = false;
                timer = setTimeout(() => {
                    moved = true;
                    haptic('heavy');
                    openView(key, lesson);
                }, 500);
            }, {passive:true});
            
            card.addEventListener('touchmove', () => {
                clearTimeout(timer);
                moved = true;
            }, {passive:true});
            
            card.addEventListener('touchend', () => clearTimeout(timer));
            
            // Обработка клика правой кнопкой мыши (контекстное меню для ПК Desktop)
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                haptic('medium');
                openView(key, lesson);
            });
            
            // Обработка обычного левого клика (перенос)
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                if (moved || state.isMoving) return;
                state.selectedLesson = { date: key, ...lesson };
                state.isMoving = true;
                document.getElementById('move-hint').classList.remove('hidden');
                haptic('medium');
                renderCalendar();
            });
            
            layer.appendChild(card);
        });
    }
}

function openAdd(date, time) {
    state.selectedLesson = null;
    document.getElementById('modal-title').textContent = 'Добавить занятие';
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = time;
    document.getElementById('lesson-duration').value = '60';
    document.getElementById('lesson-id').value = '';
    document.getElementById('repeat-group').classList.remove('hidden');
    document.getElementById('btn-save').classList.remove('hidden');
    document.getElementById('edit-actions').classList.add('hidden');
    resetForm();
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

function openView(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    document.getElementById('modal-title').textContent = lesson.student || 'Занятие';
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = lesson.time || '';
    document.getElementById('lesson-duration').value = lesson.duration || 60;
    document.getElementById('lesson-id').value = lesson.id || '';
    
    let found = false;
    for (const o of document.getElementById('student-select').options) {
        if (o.value === lesson.student_id || o.dataset.name === lesson.student) {
            document.getElementById('student-select').value = o.value;
            found = true;
            break;
        }
    }
    if (!found) {
        document.getElementById('student-select').value = 'manual';
        document.getElementById('manual-student-name').value = lesson.student || '';
        document.getElementById('manual-student-name').classList.remove('hidden');
    } else {
        document.getElementById('manual-student-name').classList.add('hidden');
    }
    
    document.getElementById('reminder-minutes').value = lesson.reminder_minutes ?? 60;
    document.getElementById('reminder-text').value = lesson.reminder_text || '';
    document.getElementById('zoom-link').value = lesson.zoom_link || '';
    
    document.getElementById('repeat-group').classList.add('hidden');
    document.getElementById('btn-save').classList.remove('hidden');
    document.getElementById('edit-actions').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('move-modal-overlay').classList.add('hidden');
}

async function saveLesson() {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    const duration = document.getElementById('lesson-duration').value;
    const sel = document.getElementById('student-select');
    
    let student = '', studentId = '';
    if (sel.value === 'manual') {
        student = document.getElementById('manual-student-name').value.trim();
    } else if (sel.value) {
        student = sel.options[sel.selectedIndex].dataset.name || sel.options[sel.selectedIndex].textContent;
        studentId = sel.value;
    }
    
    if (!student || !time) return alert('Выберите ученика и время');
    
    const payload = {
        date, time, duration: parseInt(duration || 60), student, student_id: studentId,
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
    
    const res = await fetch(API_URL + url, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.status !== 'ok') return alert(data.message || 'Ошибка сохранения');
    
    closeModal();
    fetchData();
}

async function deleteLesson() {
    if (!state.selectedLesson || !confirm('Удалить занятие?')) return;
    await fetch(API_URL + '/delete_lesson', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ date: state.selectedLesson.date, id: state.selectedLesson.id })
    });
    closeModal();
    fetchData();
}

function confirmMove(newDate, newTime) {
    state.pendingMove = { newDate, newTime };
    document.getElementById('move-modal-desc').textContent = `Перенести ${state.selectedLesson.student} на ${newDate} в ${newTime}?`;
    document.getElementById('move-modal-overlay').classList.remove('hidden');
}

async function executeMove(moveAll = false) {
    if (!state.selectedLesson || !state.pendingMove) return;
    const { newDate, newTime } = state.pendingMove;
    const oldDate = state.selectedLesson.date;
    const lessonId = state.selectedLesson.id;
    
    try {
        const res = await fetch(API_URL + '/move_lesson', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                old_date: oldDate,
                id: lessonId,
                new_date: newDate,
                new_time: newTime,
                move_all: moveAll
            })
        });
        const data = await res.json();
        if (data.status !== 'ok') alert(data.message || 'Ошибка переноса');
    } catch(e) {
        alert('Ошибка при переносе занятия');
    }
    
    cancelMove();
    closeModal();
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

// Pinch Zoom (масштабирование двумя пальцами по вертикали)
let pinchStart = 0, pinchHeight = hourHeight;
const calContainer = document.getElementById('calendar-container');

calContainer.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
        pinchStart = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        pinchHeight = hourHeight;
    }
}, {passive:true});

calContainer.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        hourHeight = Math.max(40, Math.min(160, pinchHeight + (dist - pinchStart) * 0.5));
        renderCalendar();
    }
}, {passive:false});

// Настройка слушателей кнопок
document.getElementById('student-select').onchange = e => {
    document.getElementById('manual-student-name').classList.toggle('hidden', e.target.value !== 'manual');
};

document.getElementById('btn-save').onclick = saveLesson;
document.getElementById('btn-delete').onclick = deleteLesson;
document.getElementById('btn-cancel-modal').onclick = closeModal;
document.getElementById('btn-close-modal').onclick = closeModal;

document.getElementById('btn-move-once').onclick = () => executeMove(false);
document.getElementById('btn-move-all').onclick = () => executeMove(true);
document.getElementById('btn-move-cancel').onclick = cancelMove;
document.getElementById('btn-cancel-move').onclick = cancelMove;

document.getElementById('modal-overlay').onclick = e => { if (e.target.id === 'modal-overlay') closeModal(); };
document.getElementById('move-modal-overlay').onclick = e => { if (e.target.id === 'move-modal-overlay') cancelMove(); };

document.getElementById('btn-chat').onclick = () => {
    const id = state.selectedLesson?.student_id;
    if (id && !String(id).startsWith('manual')) tg.openTelegramLink(`tg://user?id=${id}`);
    else alert('У ученика нет сохранённого Telegram ID');
};

document.getElementById('btn-prev-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate() - 7); fetchData(); };
document.getElementById('btn-next-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate() + 7); fetchData(); };
document.getElementById('btn-today').onclick = () => { state.currentMonday = getMonday(new Date()); fetchData(); };

window.addEventListener('resize', renderEvents);

// Старт
fetchData();
