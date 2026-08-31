const tg = window.Telegram.WebApp;
tg.expand();
const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
const START_HOUR = 6, END_HOUR = 23;
let hourHeight = 80;

const state = { currentMonday: getMonday(new Date()), schedule: {}, students: {}, selectedLesson: null, isMoving: false, pendingMove: null };

function getMonday(date) { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0,0,0,0); return d; }
function dateKey(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function haptic(type='light') { try { tg.HapticFeedback.impactOccurred(type); } catch(e) {} }

async function fetchData() {
    try {
        const res = await fetch(`${API_URL}/get_week_schedule`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({week_start:dateKey(state.currentMonday)}) });
        const data = await res.json();
        state.schedule = data.schedule || {};
        const sRes = await fetch(`${API_URL}/get_students`);
        state.students = (await sRes.json()).students || {};
        renderCalendar();
    } catch(e) { console.error(e); }
}

function renderCalendar() {
    const layer = document.getElementById('events-layer');
    layer.innerHTML = '<div id="current-time-line" class="current-time-line hidden"><div class="time-line-dot"></div></div>';
    
    document.documentElement.style.setProperty('--hour-height', `${hourHeight}px`);
    document.getElementById('month-label').textContent = state.currentMonday.toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
    
    const labels=document.getElementById('time-labels'), grid=document.getElementById('week-grid'), header=document.getElementById('days-header');
    labels.innerHTML=''; grid.innerHTML=''; header.innerHTML='';
    const today = dateKey(new Date());

    for(let d=0;d<7;d++){const dt=new Date(state.currentMonday);dt.setDate(dt.getDate()+d);const c=document.createElement('div');c.className='day-header-cell '+(dateKey(dt)===today?'today':'');c.innerHTML=`<div>${['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'][d]}</div><div class="day-num">${dt.getDate()}</div>`;header.appendChild(c);}
    for(let h=START_HOUR;h<=END_HOUR;h++){const l=document.createElement('div');l.className='time-label';l.style.height=hourHeight+'px';l.textContent=String(h).padStart(2,'0')+':00';labels.appendChild(l);}
    for(let d=0;d<7;d++){const col=document.createElement('div');col.className='day-column';const dt=new Date(state.currentMonday);dt.setDate(dt.getDate()+d);const key=dateKey(dt);for(let h=START_HOUR;h<=END_HOUR;h++){const s=document.createElement('div');s.className='time-slot';s.style.height=hourHeight+'px';s.onclick=()=>state.isMoving?moveAction(key,`${String(h).padStart(2,'0')}:00`):openAdd(key,`${String(h).padStart(2,'0')}:00`);col.appendChild(s);}grid.appendChild(col);}
    renderEvents(); updateCurrentTimeLine();
}

function renderEvents() {
    const layer = document.getElementById('events-layer'), colWidth = layer.clientWidth / 7;
    for(let d=0;d<7;d++){const dt=new Date(state.currentMonday);dt.setDate(dt.getDate()+d);(state.schedule[dateKey(dt)]||[]).forEach(l=>{const [h,m]=String(l.time).split(':').map(Number);if(h<START_HOUR||h>END_HOUR)return;
        const card=document.createElement('div');
        card.className=`event-card color-${state.students[l.student_id]?.color || 0} ${l.paid?'paid-status':''}`;
        card.style.top=`${((h-START_HOUR)*60+m)*hourHeight/60}px`; card.style.left=`${d*colWidth+2}px`; card.style.width=`${colWidth-4}px`; card.style.height=`${l.duration*hourHeight/60-2}px`;
        card.innerHTML=`<div class="event-title">${l.student}</div><div class="event-time">${l.time}</div>`;
        card.onclick=()=>{haptic('light'); openActionMenu(dateKey(dt), l);};
        layer.appendChild(card);
    });}

function updateCurrentTimeLine() {
    const line = document.getElementById('current-time-line');
    const now = new Date(); const today = dateKey(now);
    let col = -1; for(let i=0;i<7;i++){ const d=new Date(state.currentMonday); d.setDate(d.getDate()+i); if(dateKey(d)===today) col=i; }
    if(col===-1) return line.classList.add('hidden');
    const h=now.getHours(), m=now.getMinutes();
    if(h<START_HOUR||h>END_HOUR) return line.classList.add('hidden');
    line.style.top=`${((h-START_HOUR)*60+m)*hourHeight/60}px`; line.style.left=`${col*(document.getElementById('events-layer').clientWidth/7)}px`; line.style.width=`${document.getElementById('events-layer').clientWidth/7}px`; line.classList.remove('hidden');
}

// Меню действий
function openActionMenu(date, lesson) {
    state.selectedLesson={date,...lesson};
    document.getElementById('action-menu-title').textContent=lesson.student;
    document.getElementById('action-menu-overlay').classList.remove('hidden');
}

document.getElementById('btn-action-settings').onclick = () => {
    document.getElementById('action-menu-overlay').classList.add('hidden');
    const l=state.selectedLesson;
    document.getElementById('modal-title').textContent='Настройки';
    document.getElementById('lesson-date').value=l.date;
    document.getElementById('lesson-id').value=l.id;
    document.getElementById('fixed-student-name').value=l.student;
    document.getElementById('parent-contact').value=l.parent_contact||'';
    document.getElementById('parent-contact-type').value=l.parent_contact_type||'tg';
    document.getElementById('lesson-duration').value=l.duration||60;
    document.getElementById('lesson-price').value=l.price||'';
    document.getElementById('reminder-minutes').value=l.reminder_minutes||60;
    document.getElementById('reminder-text').value=l.reminder_text||'';
    document.getElementById('zoom-link').value=l.zoom_link||'';
    document.getElementById('modal-overlay').classList.remove('hidden');
};

document.getElementById('btn-action-move-trigger').onclick = () => {
    document.getElementById('action-menu-overlay').classList.add('hidden');
    state.isMoving=true; document.getElementById('move-hint').classList.remove('hidden'); haptic('medium');
};

// Зум
document.getElementById('btn-zoom-in').onclick = () => { hourHeight=Math.min(160, hourHeight+20); renderCalendar(); };
document.getElementById('btn-zoom-out').onclick = () => { hourHeight=Math.max(40, hourHeight-20); renderCalendar(); };

// Цвета
document.getElementById('btn-action-color').onclick = () => { document.getElementById('action-menu-overlay').classList.add('hidden'); document.getElementById('color-modal-overlay').classList.remove('hidden'); };
document.querySelectorAll('.color-swatch').forEach(sw => sw.onclick=async()=>{
    await fetch(API_URL+'/update_student_color', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({student_id:state.selectedLesson.student_id, color:sw.dataset.color})});
    document.getElementById('color-modal-overlay').classList.add('hidden'); fetchData();
});

// Навигация
document.getElementById('btn-prev-week').onclick=()=>{state.currentMonday.setDate(state.currentMonday.getDate()-7); fetchData();};
document.getElementById('btn-next-week').onclick=()=>{state.currentMonday.setDate(state.currentMonday.getDate()+7); fetchData();};
document.getElementById('btn-today').onclick=()=>{state.currentMonday=getMonday(new Date()); fetchData();};
document.getElementById('btn-close-modal').onclick=()=>{document.getElementById('modal-overlay').classList.add('hidden');};
document.getElementById('btn-cancel-modal').onclick=document.getElementById('btn-close-modal').onclick;
document.getElementById('btn-action-close').onclick=()=>document.getElementById('action-menu-overlay').classList.add('hidden');
fetchData();
