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
    editMode: false
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
function haptic(type='light') { try { tg.HapticFeedback.impactOccurred(type); } catch(e) {} }
function colorOf(name) { let n=0; for (const c of String(name||'')) n=((n<<5)-n)+c.charCodeAt(0); return Math.abs(n)%8; }

async function fetchData() {
    try {
        const scheduleResponse = await fetch(`${API_URL}/get_week_schedule`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({week_start:dateKey(state.currentMonday)}) });
        const scheduleData = await scheduleResponse.json();
        if (scheduleData.status !== 'ok') throw new Error(scheduleData.message || 'Ошибка расписания');
        state.schedule = scheduleData.schedule || {};
        const studentsResponse = await fetch(`${API_URL}/get_students`);
        const studentsData = await studentsResponse.json();
        state.students = studentsData.students || {};
        fillStudents();
        renderCalendar();
    } catch(e) { console.error(e); alert('Не удалось загрузить расписание'); }
}

function fillStudents() {
    const select = document.getElementById('student-select');
    select.innerHTML = '<option value="">-- Выбрать ученика --</option><option value="manual">Вписать вручную</option>';
    Object.entries(state.students).forEach(([id, item]) => {
        const s = typeof item === 'string' ? {name:item, user_id:id} : item;
        const opt = document.createElement('option'); opt.value=id; opt.textContent=s.name || id; opt.dataset.name=s.name || id; opt.dataset.username=s.username || ''; select.appendChild(opt);
    });
}

function renderCalendar() {
    const labels=document.getElementById('time-labels'), grid=document.getElementById('week-grid'), layer=document.getElementById('events-layer');
    labels.innerHTML=''; grid.innerHTML=''; layer.innerHTML='';
    document.documentElement.style.setProperty('--hour-height', `${hourHeight}px`);
    document.getElementById('month-label').textContent=state.currentMonday.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
    const today=dateKey(new Date()); const header=document.getElementById('days-header'); header.innerHTML='';
    for(let d=0;d<7;d++) { const dt=new Date(state.currentMonday); dt.setDate(dt.getDate()+d); const c=document.createElement('div'); c.className='day-header-cell '+(dateKey(dt)===today?'today':''); c.innerHTML=`<div>${['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'][d]}</div><div class="day-num">${dt.getDate()}</div>`; header.appendChild(c); }
    for(let h=START_HOUR;h<=END_HOUR;h++){const l=document.createElement('div');l.className='time-label';l.style.height=hourHeight+'px';l.textContent=String(h).padStart(2,'0')+':00';labels.appendChild(l);}
    for(let d=0;d<7;d++){const col=document.createElement('div');col.className='day-column';const dt=new Date(state.currentMonday);dt.setDate(dt.getDate()+d);const key=dateKey(dt);for(let h=START_HOUR;h<=END_HOUR;h++){const s=document.createElement('div');s.className='time-slot';s.style.height=hourHeight+'px';s.onclick=()=>state.isMoving?moveLesson(key,`${String(h).padStart(2,'0')}:00`):openAdd(key,`${String(h).padStart(2,'0')}:00`);col.appendChild(s);}grid.appendChild(col);}
    renderEvents();
}

function renderEvents() {
    const layer=document.getElementById('events-layer'), colWidth=layer.clientWidth/7;
    for(let d=0;d<7;d++){const dt=new Date(state.currentMonday);dt.setDate(dt.getDate()+d);const key=dateKey(dt);(state.schedule[key]||[]).forEach(lesson=>{const [h,m]=String(lesson.time||'00:00').split(':').map(Number);if(h<START_HOUR||h>END_HOUR)return;const card=document.createElement('div');const active=state.isMoving&&state.selectedLesson&&state.selectedLesson.id===lesson.id;card.className=`event-card color-${colorOf(lesson.student)} ${active?'moving-active':''}`;card.style.top=`${((h-START_HOUR)*60+m)*hourHeight/60}px`;card.style.left=`${d*colWidth+2}px`;card.style.width=`${colWidth-4}px`;card.style.height=`${hourHeight-4}px`;card.innerHTML=`<div class="event-title"></div><div class="event-time"></div>`;card.querySelector('.event-title').textContent=lesson.student||'Ученик';card.querySelector('.event-time').textContent=lesson.time;
        let timer=null, moved=false;card.addEventListener('touchstart',()=>{moved=false;timer=setTimeout(()=>{moved=true;haptic('heavy');openView(key,lesson);},500);},{passive:true});card.addEventListener('touchmove',()=>{clearTimeout(timer);moved=true;},{passive:true});card.addEventListener('touchend',()=>clearTimeout(timer));card.addEventListener('click',e=>{e.stopPropagation();if(moved)return;if(state.isMoving)return;state.selectedLesson={date:key,...lesson};state.isMoving=true;document.getElementById('move-hint').classList.remove('hidden');haptic('medium');renderCalendar();});layer.appendChild(card);});}
}

function openAdd(date,time){state.selectedLesson=null;state.editMode=true;document.getElementById('modal-title').textContent='Добавить занятие';document.getElementById('lesson-date').value=date;document.getElementById('lesson-time').value=time;document.getElementById('lesson-id').value='';document.getElementById('repeat-group').classList.remove('hidden');document.getElementById('btn-save').classList.remove('hidden');document.getElementById('edit-actions').classList.add('hidden');resetForm();document.getElementById('modal-overlay').classList.remove('hidden');}
function resetForm(){document.getElementById('student-select').value='';document.getElementById('manual-student-name').value='';document.getElementById('manual-student-name').classList.add('hidden');document.getElementById('reminder-minutes').value='60';document.getElementById('reminder-text').value='';document.getElementById('zoom-link').value='';document.getElementById('lesson-repeat').value='no';}
function openView(date,lesson){state.selectedLesson={date,...lesson};state.editMode=false;document.getElementById('modal-title').textContent=lesson.student||'Занятие';document.getElementById('lesson-date').value=date;document.getElementById('lesson-time').value=lesson.time;document.getElementById('lesson-id').value=lesson.id||'';document.getElementById('repeat-group').classList.add('hidden');document.getElementById('btn-save').classList.add('hidden');document.getElementById('edit-actions').classList.remove('hidden');document.getElementById('modal-overlay').classList.remove('hidden');}
function closeModal(){document.getElementById('modal-overlay').classList.add('hidden');state.editMode=false;}
function enableSettings(){state.editMode=true;document.getElementById('modal-title').textContent='Настройки занятия';document.getElementById('lesson-time').disabled=false;document.getElementById('repeat-group').classList.remove('hidden');document.getElementById('btn-save').classList.remove('hidden');document.getElementById('edit-actions').classList.add('hidden');const l=state.selectedLesson;if(!l)return;let found=false;for(const o of document.getElementById('student-select').options){if(o.value===l.student_id||o.dataset.name===l.student){document.getElementById('student-select').value=o.value;found=true;break;}}if(!found){document.getElementById('student-select').value='manual';document.getElementById('manual-student-name').value=l.student;document.getElementById('manual-student-name').classList.remove('hidden');}document.getElementById('reminder-minutes').value=l.reminder_minutes??60;document.getElementById('reminder-text').value=l.reminder_text||'';document.getElementById('zoom-link').value=l.zoom_link||'';}

async function saveLesson(){const date=document.getElementById('lesson-date').value,time=document.getElementById('lesson-time').value,sel=document.getElementById('student-select');let student='',studentId='';if(sel.value==='manual')student=document.getElementById('manual-student-name').value.trim();else if(sel.value){student=sel.options[sel.selectedIndex].dataset.name||sel.options[sel.selectedIndex].textContent;studentId=sel.value;}if(!student||!time)return alert('Выберите ученика и время');const payload={date,time,student,student_id:studentId,reminder_minutes:document.getElementById('reminder-minutes').value,reminder_text:document.getElementById('reminder-text').value,zoom_link:document.getElementById('zoom-link').value,repeat:document.getElementById('lesson-repeat').value};let url='/add_lesson';if(state.selectedLesson&&state.editMode){url='/update_lesson';payload.id=state.selectedLesson.id;}const res=await fetch(API_URL+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();if(data.status!=='ok')return alert(data.message||'Ошибка');closeModal();fetchData();}

async function deleteLesson(){if(!state.selectedLesson||!confirm('Удалить занятие?'))return;await fetch(API_URL+'/delete_lesson',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:state.selectedLesson.date,id:state.selectedLesson.id})});closeModal();fetchData();}
async function moveLesson(date,time){if(!state.selectedLesson)return;const old=state.selectedLesson;await fetch(API_URL+'/delete_lesson',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:old.date,id:old.id})});await fetch(API_URL+'/add_lesson',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,time,student:old.student,student_id:old.student_id,reminder_minutes:old.reminder_minutes,reminder_text:old.reminder_text,zoom_link:old.zoom_link})});cancelMove();fetchData();}
function cancelMove(){state.isMoving=false;state.selectedLesson=null;document.getElementById('move-hint').classList.add('hidden');renderCalendar();}

// Отключаем обработку жеста браузером только при двух пальцах и меняем высоту часа.
let pinchStart=0,pinchHeight=hourHeight;
document.getElementById('calendar-container').addEventListener('touchstart',e=>{if(e.touches.length===2){pinchStart=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);pinchHeight=hourHeight;}},{passive:true});
document.getElementById('calendar-container').addEventListener('touchmove',e=>{if(e.touches.length===2){e.preventDefault();const dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);hourHeight=Math.max(40,Math.min(150,pinchHeight+(dist-pinchStart)*0.5));renderCalendar();}},{passive:false});

document.getElementById('student-select').onchange=e=>document.getElementById('manual-student-name').classList.toggle('hidden',e.target.value!=='manual');
document.getElementById('btn-save').onclick=saveLesson;document.getElementById('btn-delete').onclick=deleteLesson;document.getElementById('btn-cancel-modal').onclick=closeModal;document.getElementById('btn-close-modal').onclick=closeModal;document.getElementById('modal-overlay').onclick=e=>{if(e.target.id==='modal-overlay')closeModal();};document.getElementById('btn-cancel-move').onclick=cancelMove;
document.getElementById('btn-chat').onclick=()=>{const id=state.selectedLesson?.student_id;if(id&&!String(id).startsWith('manual'))tg.openTelegramLink(`tg://user?id=${id}`);else alert('У ученика нет Telegram ID');};
// Кнопка настроек добавляется динамически для меню существующего занятия.
const settingsButton=document.createElement('button');settingsButton.id='btn-settings';settingsButton.className='secondary-btn';settingsButton.textContent='⚙️ Настройки';settingsButton.onclick=enableSettings;document.getElementById('edit-actions').insertBefore(settingsButton,document.getElementById('btn-delete'));
document.getElementById('btn-prev-week').onclick=()=>{state.currentMonday.setDate(state.currentMonday.getDate()-7);fetchData();};document.getElementById('btn-next-week').onclick=()=>{state.currentMonday.setDate(state.currentMonday.getDate()+7);fetchData();};document.getElementById('btn-today').onclick=()=>{state.currentMonday=getMonday(new Date());fetchData();};
window.addEventListener('resize',renderEvents);
fetchData();