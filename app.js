const tg = window.Telegram.WebApp;
tg.expand();
const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
let HOUR_HEIGHT = 80;

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
    d.setDate(diff); d.setHours(0,0,0,0); return d;
}
function formatDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function haptic(type = 'light') { try { tg.HapticFeedback.impactOccurred(type); } catch(e){} }

async function fetchData() {
    const res = await fetch(`${API_URL}/get_week_schedule`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ week_start: formatDateKey(state.currentMonday) })
    });
    const data = await res.json();
    state.schedule = data.schedule || {};
    
    const studentsRes = await fetch(`${API_URL}/get_students`);
    const sData = await studentsRes.json();
    state.students = sData.students || {};
    
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('week-grid');
    const labels = document.getElementById('time-labels');
    const layer = document.getElementById('events-layer');
    grid.innerHTML = ''; labels.innerHTML = ''; layer.innerHTML = '';
    document.getElementById('month-label').textContent = state.currentMonday.toLocaleDateString('ru-RU', {month:'long', year:'numeric'});

    for(let h=6; h<=23; h++) {
        const l = document.createElement('div'); l.className='time-label'; l.style.height=HOUR_HEIGHT+'px'; l.textContent=`${String(h).padStart(2,'0')}:00`;
        labels.appendChild(l);
    }
    for(let d=0; d<7; d++) {
        const col = document.createElement('div'); col.className='day-column';
        const date = new Date(state.currentMonday); date.setDate(date.getDate()+d);
        const key = formatDateKey(date);
        for(let h=6; h<=23; h++) {
            const slot = document.createElement('div'); slot.className='time-slot'; slot.style.height=HOUR_HEIGHT+'px';
            slot.onclick = () => { if(state.isMoving) moveLesson(key, `${String(h).padStart(2,'0')}:00`); else openModal(key, `${String(h).padStart(2,'0')}:00`); };
            col.appendChild(slot);
        }
        grid.appendChild(col);
    }
    renderEvents();
}

function renderEvents() {
    const layer = document.getElementById('events-layer');
    const colWidth = layer.clientWidth / 7;
    for(let d=0; d<7; d++) {
        const date = new Date(state.currentMonday); date.setDate(date.getDate()+d);
        (state.schedule[formatDateKey(date)] || []).forEach(l => {
            const [h, m] = l.time.split(':').map(Number);
            const card = document.createElement('div');
            card.className = `event-card color-${Math.abs(l.student.charCodeAt(0))%8} ${state.isMoving && state.selectedLesson?.id===l.id ? 'moving-active' : ''}`;
            card.style.top = `${((h-6)*60 + m) * (HOUR_HEIGHT/60)}px`;
            card.style.left = `${d*colWidth+2}px`; card.style.width = `${colWidth-4}px`; card.style.height = `${HOUR_HEIGHT-4}px`;
            card.innerHTML = `<div class="event-title">${l.student}</div><div class="event-time">${l.time}</div>`;
            
            let timer;
            card.ontouchstart = () => timer = setTimeout(() => { haptic('heavy'); openModal(formatDateKey(date), l.time, l); }, 500);
            card.ontouchend = () => clearTimeout(timer);
            card.onclick = (e) => { e.stopPropagation(); if(state.isMoving) return; state.selectedLesson={date:formatDateKey(date), ...l}; state.isMoving=true; haptic('medium'); document.getElementById('move-hint').classList.remove('hidden'); renderCalendar(); };
            layer.appendChild(card);
        });
    }
}

function openModal(date, time, lesson=null) {
    state.selectedLesson = lesson;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = time;
    document.getElementById('student-name').value = lesson ? lesson.student : '';
    document.getElementById('edit-actions').classList.toggle('hidden', !lesson);
    document.getElementById('btn-save').classList.toggle('hidden', !!lesson);
}

document.getElementById('btn-save').onclick = async () => {
    const payload = {date:document.getElementById('lesson-date').value, time:document.getElementById('lesson-time').value, student:document.getElementById('student-name').value, user_id:user.id};
    await fetch(`${API_URL}/add_lesson`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    closeModal(); fetchData();
};

document.getElementById('btn-delete').onclick = async () => {
    await fetch(`${API_URL}/delete_lesson`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({date:state.selectedLesson.date, id:state.selectedLesson.id})});
    closeModal(); fetchData();
};

async function moveLesson(d, t) {
    await fetch(`${API_URL}/delete_lesson`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({date:state.selectedLesson.date, id:state.selectedLesson.id})});
    await fetch(`${API_URL}/add_lesson`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({date:d, time:t, student:state.selectedLesson.student, user_id:user.id})});
    state.isMoving = false; document.getElementById('move-hint').classList.add('hidden'); fetchData();
}

function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }
document.getElementById('btn-cancel').onclick = closeModal;

// Pinch zoom
let initialPinchDist = 0;
document.addEventListener('touchmove', e => {
    if(e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if(initialPinchDist) HOUR_HEIGHT += (dist - initialPinchDist) * 0.1;
        initialPinchDist = dist; HOUR_HEIGHT = Math.max(40, Math.min(150, HOUR_HEIGHT)); renderCalendar();
    }
}, {passive:false});
document.addEventListener('touchend', () => initialPinchDist = 0);

document.getElementById('btn-prev-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate()-7); fetchData(); };
document.getElementById('btn-next-week').onclick = () => { state.currentMonday.setDate(state.currentMonday.getDate()+7); fetchData(); };
document.getElementById('btn-today').onclick = () => { state.currentMonday = getMonday(new Date()); fetchData(); };
fetchData();