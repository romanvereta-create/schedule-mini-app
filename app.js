const tg = window.Telegram.WebApp;
tg.expand();

const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
const START_HOUR = 6;
const END_HOUR = 23;
const MIN_HOUR_HEIGHT = 40;
const MAX_HOUR_HEIGHT = 160;
const ZOOM_STEP = 20;

let hourHeight = 80;
let weekTransitioning = false;

const state = {
    currentMonday: getMonday(new Date()),
    schedule: {},
    students: {},
    selectedLesson: null,
    isMoving: false,
    pendingMove: null,
    editingExisting: false,
    settings: { default_reminders_enabled: true, default_send_receipts: true, default_send_receipt_copy: true },
    datePickerMonth: new Date(),
    workCenter: null
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
    if (typeof info.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(info.color)) return info.color;
    if (info.color !== undefined && info.color !== null) {
        const numericColor = Number(info.color);
        if (Number.isInteger(numericColor) && numericColor >= 0 && numericColor <= 7) return numericColor;
    }
    let hash = 0;
    for (const char of String(name || '')) hash = ((hash << 5) - hash) + char.charCodeAt(0);
    return Math.abs(hash) % 7;
}

function apiHeaders(extraHeaders = {}, body = null) {
    const headers = {
        'X-Telegram-Init-Data': tg.initData || '',
        ...extraHeaders
    };
    if (!(body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return headers;
}

async function apiFetch(path, options = {}) {
    const response = await fetch(API_URL + path, {
        ...options,
        headers: apiHeaders(options.headers || {}, options.body || null)
    });
    if (response.status === 401) {
        throw new Error('Доступ к API отклонён. Откройте календарь через Telegram-бота.');
    }
    return response;
}

async function fetchWeekSchedule(monday) {
    const requestedWeek = dateKey(monday);
    const response = await apiFetch('/get_week_schedule', {
        method: 'POST',
        body: JSON.stringify({ week_start: requestedWeek })
    });
    const data = await response.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Ошибка расписания');
    return { requestedWeek, schedule: data.schedule || {} };
}

async function loadSchedule() {
    const requestedMonday = new Date(state.currentMonday);
    const data = await fetchWeekSchedule(requestedMonday);

    // Если пользователь успел перелистнуть неделю, не затираем новый экран старым ответом.
    if (data.requestedWeek !== dateKey(state.currentMonday)) return false;
    state.schedule = data.schedule;
    renderCalendar();
    return true;
}

async function loadStudents() {
    const response = await apiFetch('/get_students');
    const data = await response.json();
    if (!response.ok || data.status === 'error') throw new Error(data.message || 'Ошибка загрузки учеников');
    state.students = data.students || {};
    fillStudentsDropdown();
    return true;
}

async function loadSettings() {
    try {
        const response = await apiFetch('/get_settings');
        if (!response.ok) return false;
        const data = await response.json();
        if (data.status === 'ok') state.settings = data.settings || state.settings;
        return true;
    } catch (error) {
        console.warn('Настройки пока недоступны:', error);
        return false;
    }
}

function scheduleWorkCenterRefresh(delay = 300) {
    window.clearTimeout(scheduleWorkCenterRefresh.timer);
    scheduleWorkCenterRefresh.timer = window.setTimeout(() => {
        refreshWorkCenterBadge();
    }, delay);
}

async function fetchData() {
    try {
        // Независимые стартовые запросы идут одновременно, а не цепочкой.
        await Promise.all([loadSchedule(), loadStudents(), loadSettings()]);
        renderCalendar();
        scheduleWorkCenterRefresh();
    } catch (error) {
        console.error('Ошибка загрузки:', error);
    }
}

async function refreshScheduleOnly({ refreshHelper = true } = {}) {
    try {
        const applied = await loadSchedule();
        if (applied && refreshHelper) scheduleWorkCenterRefresh();
    } catch (error) {
        console.error('Ошибка загрузки расписания:', error);
    }
}

async function refreshScheduleAndStudents() {
    try {
        await Promise.all([loadSchedule(), loadStudents()]);
        renderCalendar();
        scheduleWorkCenterRefresh();
    } catch (error) {
        console.error('Ошибка обновления данных:', error);
    }
}

async function refreshStudentsOnly() {
    try {
        await loadStudents();
        renderCalendar();
        scheduleWorkCenterRefresh();
    } catch (error) {
        console.error('Ошибка обновления учеников:', error);
    }
}

function fillStudentsDropdown() {
    const select = document.getElementById('student-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Выбрать ученика --</option><option value="manual">Вписать вручную...</option>';

    Object.entries(state.students).forEach(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
        if (info.status === 'paused') return;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = info.name || id;
        option.dataset.name = info.name || id;
        select.appendChild(option);
    });
}

function groupMemberOptions(selectedId = '') {
    const options = ['<option value="">-- Выбрать ученика --</option>', '<option value="manual">Вписать вручную...</option>'];
    Object.entries(state.students).forEach(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
        if (info.status === 'paused' && String(id) !== String(selectedId)) return;
        const selected = String(id) === String(selectedId) ? ' selected' : '';
        options.push(`<option value="${escapeHtml(String(id))}" data-name="${escapeHtml(info.name || String(id))}"${selected}>${escapeHtml(info.name || String(id))}</option>`);
    });
    return options.join('');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function addGroupMemberRow(member = null) {
    const container = document.getElementById('group-members-container');
    const row = document.createElement('div');
    row.className = 'group-member-row';
    const memberId = member?.student_id || '';
    const known = memberId && state.students[memberId];
    const manual = member && !known;
    row.innerHTML = `
        <select class="group-member-select">${groupMemberOptions(manual ? 'manual' : memberId)}</select>
        <input type="text" class="group-member-manual ${manual ? '' : 'hidden'}" placeholder="Имя ученика" value="${escapeHtml(manual ? (member?.name || '') : '')}">
        <button type="button" class="contact-remove-btn group-member-remove" title="Удалить">✕</button>
    `;
    const select = row.querySelector('.group-member-select');
    const input = row.querySelector('.group-member-manual');
    if (manual) select.value = 'manual';
    select.addEventListener('change', () => {
        const isManual = select.value === 'manual';
        input.classList.toggle('hidden', !isManual);
        if (isManual) input.focus();
    });
    row.querySelector('.group-member-remove').onclick = () => row.remove();
    container.appendChild(row);
}

function renderGroupMembers(members = []) {
    const container = document.getElementById('group-members-container');
    container.innerHTML = '';
    (members || []).forEach(member => addGroupMemberRow(member));
    if (!members || !members.length) addGroupMemberRow();
}

function collectGroupMembers() {
    const result = [];
    document.querySelectorAll('#group-members-container .group-member-row').forEach(row => {
        const select = row.querySelector('.group-member-select');
        const manualInput = row.querySelector('.group-member-manual');
        if (!select?.value) return;
        if (select.value === 'manual') {
            const name = manualInput?.value.trim() || '';
            if (name) result.push({ student_id: 'manual', name });
        } else {
            const option = select.options[select.selectedIndex];
            result.push({ student_id: select.value, name: option?.dataset.name || option?.textContent || select.value });
        }
    });
    return result;
}

function updateLessonTypeUI() {
    const type = document.getElementById('lesson-type-select').value;
    const isGroup = type === 'group';
    document.getElementById('group-editor-group').classList.toggle('hidden', !isGroup);
    document.getElementById('student-select-group').classList.toggle('hidden', isGroup || state.editingExisting);
    document.getElementById('student-fixed-group').classList.toggle('hidden', isGroup || !state.editingExisting);
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
            const colorClass = typeof color === 'number' ? `color-${color}` : '';
            const isGroup = lesson.lesson_type === 'group';
            const groupMembers = Array.isArray(lesson.group_members) ? lesson.group_members : [];
            const groupPaidCount = groupMembers.filter(member => member.paid).length;
            const partiallyPaid = isGroup && groupPaidCount > 0 && groupPaidCount < groupMembers.length;
            card.className = `event-card ${colorClass} ${lesson.paid ? 'paid-status' : ''} ${partiallyPaid ? 'partial-paid-status' : ''} ${isGroup ? 'group-event' : ''} ${isActiveMove ? 'moving-active' : ''}`;
            if (typeof color === 'string') card.style.backgroundColor = color;

            const top = ((hour - START_HOUR) * 60 + minute) * hourHeight / 60;
            const height = Math.max(18, duration * hourHeight / 60 - 2);
            card.style.top = `${top}px`;
            card.style.left = `${dayIndex * colWidth + 2}px`;
            card.style.width = `${Math.max(20, colWidth - 4)}px`;
            card.style.height = `${height}px`;
            card.dataset.startMinutes = String((hour - START_HOUR) * 60 + minute);
            card.dataset.durationMinutes = String(duration);

            const title = document.createElement('div');
            title.className = 'event-title';
            const studentInfo = isGroup ? {} : getStudentInfo(lesson.student_id);
            title.textContent = isGroup
                ? (lesson.group_name || lesson.student || 'Группа')
                : (studentInfo.calendar_name || lesson.student || studentInfo.name || 'Ученик');
            const cardHeight = height;
            if (cardHeight < 34) card.classList.add('event-card-compact');
            else if (cardHeight < 54) card.classList.add('event-card-medium');
            else card.classList.add('event-card-tall');
            card.appendChild(title);
            if (isGroup && groupMembers.length) {
                const meta = document.createElement('div');
                meta.className = 'event-group-meta';
                meta.textContent = `${groupPaidCount}/${groupMembers.length} оплачено`;
                card.appendChild(meta);
            }

            let longPressed = false;
            let timer = null;
            card.addEventListener('touchstart', () => {
                longPressed = false;
                timer = setTimeout(() => {
                    longPressed = true;
                    haptic('heavy');
                    startMove(key, lesson);
                }, 500);
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
    const minutes = now.getHours() * 60 + Math.floor(now.getMinutes() / 5) * 5 - START_HOUR * 60;
    line.style.top = `${minutes * hourHeight / 60}px`;
    line.style.left = `${todayColumn * columnWidth}px`;
    line.style.width = `${columnWidth}px`;
    line.classList.remove('hidden');
}

setInterval(updateCurrentTimeLine, 5 * 60 * 1000);

function openActionMenu(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    const isGroup = lesson.lesson_type === 'group';
    document.getElementById('action-menu-title').textContent = `${isGroup ? (lesson.group_name || lesson.student || 'Группа') : (lesson.student || 'Ученик')} · ${lesson.time || '--:--'}`;
    document.getElementById('btn-action-paid').textContent = isGroup ? '💳 Оплата группы' : (lesson.paid ? '✅ Оплачено (снять)' : '💳 Оплатил');
    document.getElementById('btn-action-subscription').classList.toggle('hidden', isGroup);
    document.getElementById('btn-action-student-card').classList.toggle('hidden', isGroup);
    document.getElementById('btn-action-chat-student').classList.toggle('hidden', isGroup);
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
    const response = await apiFetch('/move_lesson', { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка переноса');
    cancelMove();
    refreshScheduleOnly();
}

function cancelMove() {
    state.isMoving = false;
    state.selectedLesson = null;
    state.pendingMove = null;
    document.getElementById('move-hint').classList.add('hidden');
    document.getElementById('move-modal-overlay').classList.add('hidden');
    renderCalendar();
}

const CONTACT_TYPES = {
    tg: { icon: '✈️', placeholder: '@username или ID' },
    wa: { icon: '🟢', placeholder: 'WhatsApp номер' },
    phone: { icon: '☎️', placeholder: 'Телефон' },
    max: { icon: 'M', placeholder: 'Max (ник)' }
};

function createContactRow(type = 'tg', value = '', removable = true) {
    const normalizedType = CONTACT_TYPES[type] ? type : 'tg';
    const row = document.createElement('div');
    row.className = 'contact-row';
    row.dataset.type = normalizedType;

    const select = document.createElement('select');
    select.className = 'contact-type-select';
    select.setAttribute('aria-label', 'Мессенджер');
    Object.entries(CONTACT_TYPES).forEach(([key, meta]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = meta.icon;
        option.selected = key === normalizedType;
        select.appendChild(option);
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'contact-input';
    input.dataset.field = normalizedType;
    input.placeholder = CONTACT_TYPES[normalizedType].placeholder;
    input.value = value || '';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'contact-remove-btn';
    remove.title = 'Удалить контакт';
    remove.textContent = '✕';
    remove.style.visibility = removable ? 'visible' : 'hidden';

    select.addEventListener('change', () => {
        const nextType = select.value;
        row.dataset.type = nextType;
        input.dataset.field = nextType;
        input.placeholder = CONTACT_TYPES[nextType].placeholder;
    });
    remove.addEventListener('click', () => row.remove());

    row.append(select, input, remove);
    return row;
}

function renderContacts(containerId, contacts = {}, defaultType = 'tg') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const addButton = container.querySelector('.add-contact-btn');
    container.querySelectorAll('.contact-row').forEach(row => row.remove());

    const entries = Object.entries(contacts || {}).filter(([type, value]) => CONTACT_TYPES[type] && String(value || '').trim());
    if (entries.length === 0) entries.push([defaultType, '']);

    entries.forEach(([type, value], index) => {
        const row = createContactRow(type, value, index > 0);
        container.insertBefore(row, addButton);
    });
}

function addContactRow(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const used = new Set(Array.from(container.querySelectorAll('.contact-row')).map(row => row.dataset.type));
    const type = Object.keys(CONTACT_TYPES).find(key => !used.has(key));
    if (!type) return alert('Все типы контактов уже добавлены');
    const row = createContactRow(type, '', true);
    container.insertBefore(row, container.querySelector('.add-contact-btn'));
    row.querySelector('.contact-input').focus();
}

function getContacts(containerId) {
    const contacts = {};
    document.querySelectorAll(`#${containerId} .contact-row`).forEach(row => {
        const input = row.querySelector('.contact-input');
        const type = row.querySelector('.contact-type-select')?.value || row.dataset.type;
        const value = input?.value.trim() || '';
        if (value && CONTACT_TYPES[type]) contacts[type] = value;
    });
    return contacts;
}

function updateReminderControls() {
    const enabled = document.getElementById('reminder-enabled').checked;
    const input = document.getElementById('reminder-minutes');
    const wrap = document.getElementById('reminder-minutes-wrap');
    input.disabled = !enabled;
    wrap.classList.toggle('disabled', !enabled);
}

function resetAddForm() {
    document.getElementById('lesson-type-select').value = 'student';
    document.getElementById('group-name').value = '';
    renderGroupMembers([]);
    document.getElementById('student-select').value = '';
    document.getElementById('manual-student-name').value = '';
    document.getElementById('manual-student-name').classList.add('hidden');
    document.getElementById('lesson-repeat').value = 'no';
    document.getElementById('reminder-enabled').checked = state.settings.default_reminders_enabled !== false;
    document.getElementById('reminder-minutes').value = '60';
    document.getElementById('reminder-text').value = '';
    document.getElementById('zoom-link').value = '';
    updateReminderControls();
    updateLessonTypeUI();
}

function openAddModal(date, time) {
    state.selectedLesson = null;
    state.editingExisting = false;
    document.getElementById('modal-title').textContent = 'Добавить занятие';
    document.getElementById('lesson-type-group').classList.remove('hidden');
    document.getElementById('student-select-group').classList.remove('hidden');
    document.getElementById('student-fixed-group').classList.add('hidden');
    document.getElementById('time-duration-group').classList.remove('hidden');
    document.getElementById('repeat-group').classList.remove('hidden');
    resetAddForm();
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = time;
    document.getElementById('lesson-duration').value = '60';
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEditModal(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    state.editingExisting = true;
    const isGroup = lesson.lesson_type === 'group';
    document.getElementById('modal-title').textContent = isGroup ? 'Настройки группы' : 'Настройки ученика';
    document.getElementById('lesson-type-select').value = isGroup ? 'group' : 'student';
    document.getElementById('lesson-type-group').classList.add('hidden');
    document.getElementById('group-name').value = lesson.group_name || lesson.student || '';
    renderGroupMembers(lesson.group_members || []);
    document.getElementById('fixed-student-name').value = lesson.student || '';
    updateLessonTypeUI();
    document.getElementById('time-duration-group').classList.add('hidden');
    document.getElementById('repeat-group').classList.add('hidden');
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = lesson.time || '10:00';
    document.getElementById('lesson-duration').value = lesson.duration || 60;
    document.getElementById('lesson-id').value = lesson.id || '';
    document.getElementById('reminder-enabled').checked = lesson.reminder_enabled !== false;
    document.getElementById('reminder-minutes').value = lesson.reminder_minutes ?? 60;
    document.getElementById('reminder-text').value = lesson.reminder_text || '';
    document.getElementById('zoom-link').value = lesson.zoom_link || '';

    updateReminderControls();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

async function saveLesson() {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    const duration = parseInt(document.getElementById('lesson-duration').value || 60, 10);
    const lessonType = document.getElementById('lesson-type-select').value === 'group' ? 'group' : 'student';
    let student = '';
    let studentId = '';
    let groupName = '';
    let groupMembers = [];

    if (lessonType === 'group') {
        groupName = document.getElementById('group-name').value.trim();
        groupMembers = collectGroupMembers();
        if (!groupName) return alert('Укажите название группы');
        if (!groupMembers.length) return alert('Добавьте хотя бы одного ученика в группу');
    } else if (state.editingExisting) {
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

    if (lessonType === 'student' && !student) return alert('Укажите ученика');
    if (!time) return alert('Укажите время');

    const payload = {
        date, time, duration, lesson_type: lessonType,
        student, student_id: studentId,
        group_name: groupName, group_members: groupMembers,
        reminder_enabled: document.getElementById('reminder-enabled').checked,
        reminder_minutes: document.getElementById('reminder-minutes').value || 60,
        reminder_text: document.getElementById('reminder-text').value,
        zoom_link: document.getElementById('zoom-link').value,
        repeat: document.getElementById('lesson-repeat').value
    };
    const endpoint = state.editingExisting ? '/update_lesson' : '/add_lesson';
    if (state.editingExisting) payload.id = state.selectedLesson.id;

    const response = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения');
    closeAllModals();
    refreshScheduleAndStudents();
}

function closeAllModals() {
    ['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'date-picker-overlay', 'app-settings-overlay', 'receipt-settings-overlay', 'student-card-overlay', 'work-center-overlay', 'paid-confirm-overlay', 'subscription-pay-overlay'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

// Палитра цветов в меню действий
document.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', async () => {
        if (el.id === 'color-picker-open') {
            const input = document.createElement('input');
            input.type = 'color';
            input.value = '#5c6bc0';
            input.addEventListener('input', async (e) => {
                const color = e.target.value;
                const response = await apiFetch('/update_student_color', {
                    method: 'POST',
                    body: JSON.stringify({ student_id: state.selectedLesson?.student_id, color: color })
                });
                const result = await response.json();
                if (result.status !== 'ok') return alert(result.message || 'Ошибка изменения цвета');
                closeAllModals();
                refreshStudentsOnly();
            });
            input.click();
            return;
        }
        const color = el.dataset.color;
        const response = await apiFetch('/update_student_color', {
            method: 'POST',
            body: JSON.stringify({ student_id: state.selectedLesson?.student_id, color: color })
        });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка изменения цвета');
        closeAllModals();
        refreshStudentsOnly();
    });
});

// Добавление контактов
 document.querySelectorAll('.add-contact-btn').forEach(button => {
    button.addEventListener('click', () => addContactRow(button.dataset.target));
});
document.getElementById('reminder-enabled').addEventListener('change', updateReminderControls);

document.getElementById('lesson-type-select').addEventListener('change', updateLessonTypeUI);
document.getElementById('btn-add-group-member').addEventListener('click', () => addGroupMemberRow());

// Переключатель ручного ввода
document.getElementById('student-select').addEventListener('change', event => {
    const input = document.getElementById('manual-student-name');
    const manual = event.target.value === 'manual';
    input.classList.toggle('hidden', !manual);
    if (manual) input.focus();
});

// Меню действий
document.getElementById('btn-action-student-card').onclick = () => { closeActionMenu(); if (state.selectedLesson) openStudentCard(state.selectedLesson.student_id); };
document.getElementById('btn-action-settings').onclick = () => { closeActionMenu(); if (state.selectedLesson) openEditModal(state.selectedLesson.date, state.selectedLesson); };
document.getElementById('btn-action-move-trigger').onclick = () => { closeActionMenu(); if (state.selectedLesson) startMove(state.selectedLesson.date, state.selectedLesson); };
document.getElementById('btn-action-paid').onclick = async () => {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const isGroup = lesson.lesson_type === 'group';

    if (!isGroup && lesson.paid) {
        if (!confirm(`Снять отметку об оплате у занятия ${lesson.student || ''} ${lesson.time || ''}?`)) return;
        const response = await apiFetch('/mark_paid', {
            method: 'POST',
            body: JSON.stringify({ date: lesson.date, id: lesson.id, paid: false, send_receipt: false })
        });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка изменения оплаты');
        closeActionMenu();
        refreshScheduleOnly();
        return;
    }

    document.getElementById('paid-confirm-title').textContent = `${isGroup ? (lesson.group_name || 'Группа') : (lesson.student || 'Ученик')} · ${lesson.time || '--:--'}`;
    document.getElementById('paid-confirm-desc').textContent = isGroup
        ? 'Отметьте учеников, которые оплатили. Сумма берётся из карточки каждого ученика.'
        : (() => { const price = Number(getStudentInfo(lesson.student_id).default_price || lesson.price || 0); return `Подтвердить оплату${price > 0 ? ` на ${price.toLocaleString('ru-RU')} ₽` : ''}?`; })();
    const membersBox = document.getElementById('group-paid-members');
    membersBox.innerHTML = '';
    membersBox.classList.toggle('hidden', !isGroup);
    if (isGroup) {
        (lesson.group_members || []).forEach(member => {
            const label = document.createElement('label');
            label.className = 'group-paid-member-row';
            const memberPrice = Number(getStudentInfo(member.student_id).default_price || lesson.price || 0);
            label.innerHTML = `<input type="checkbox" value="${escapeHtml(member.student_id || '')}" ${member.paid ? 'checked' : ''}><span>${escapeHtml(member.name || 'Ученик')}${memberPrice > 0 ? ` · ${memberPrice.toLocaleString('ru-RU')} ₽` : ' · цена не указана'}</span>`;
            membersBox.appendChild(label);
        });
    }
    document.getElementById('send-receipt-checkbox').checked = state.settings.default_send_receipts !== false;
    closeActionMenu();
    document.getElementById('paid-confirm-overlay').classList.remove('hidden');
};

document.getElementById('btn-action-subscription').onclick = () => {
    const lesson = state.selectedLesson;
    if (!lesson || lesson.lesson_type === 'group') return;
    const info = getStudentInfo(lesson.student_id);
    const price = Number(info.default_price || lesson.price || 0);
    if (!(price > 0)) {
        closeActionMenu();
        alert('Сначала укажите стоимость урока в карточке ученика.');
        return;
    }
    document.getElementById('subscription-pay-title').textContent = `Абонемент · ${info.calendar_name || lesson.student || info.name || 'Ученик'}`;
    document.getElementById('subscription-pay-desc').textContent = `Стоимость одного урока: ${price.toLocaleString('ru-RU')} ₽. Укажите общую сумму абонемента.`;
    const amountInput = document.getElementById('subscription-pay-amount');
    amountInput.value = String(price * 3);
    document.getElementById('subscription-custom-count').dataset.count = '3';
    document.getElementById('subscription-custom-count').textContent = '3 занятия';
    document.getElementById('subscription-send-receipt-checkbox').checked = state.settings.default_send_receipts !== false;
    updateSubscriptionPayHint();
    closeActionMenu();
    document.getElementById('subscription-pay-overlay').classList.remove('hidden');
    setTimeout(() => amountInput.focus(), 50);
};

function subscriptionCountWord(count) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return 'занятий';
    if (mod10 === 1) return 'занятие';
    if (mod10 >= 2 && mod10 <= 4) return 'занятия';
    return 'занятий';
}

function getSubscriptionLessonCount() {
    const el = document.getElementById('subscription-custom-count');
    return Math.max(2, Number(el?.dataset.count || 2));
}

function setSubscriptionLessonCount(count) {
    const el = document.getElementById('subscription-custom-count');
    if (!el) return;
    const safeCount = Math.max(2, Math.round(Number(count) || 2));
    el.dataset.count = String(safeCount);
    el.textContent = `${safeCount} ${subscriptionCountWord(safeCount)}`;
    updateSubscriptionPayHint();
}

function updateSubscriptionPayHint() {
    const lesson = state.selectedLesson;
    const hint = document.getElementById('subscription-pay-hint');
    if (!lesson || !hint) return;
    const price = Number(getStudentInfo(lesson.student_id).default_price || lesson.price || 0);
    const amount = Number(document.getElementById('subscription-pay-amount').value || 0);
    const lessonCount = getSubscriptionLessonCount();
    if (!(price > 0) || !(amount > 0)) { hint.textContent = ''; return; }
    const effectivePrice = amount / lessonCount;
    const regularTotal = price * lessonCount;
    const discount = regularTotal > amount ? ((regularTotal - amount) / regularTotal) * 100 : 0;
    const discountText = discount > 0.01 ? ` · скидка ${discount.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : '';
    hint.textContent = `Будет оплачено: ${lessonCount} ${subscriptionCountWord(lessonCount)} · ${effectivePrice.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽ / занятие${discountText}.`;
}

document.getElementById('subscription-pay-amount').addEventListener('input', () => {
    const lesson = state.selectedLesson;
    const price = Number(getStudentInfo(lesson?.student_id).default_price || lesson?.price || 0);
    const amount = Number(document.getElementById('subscription-pay-amount').value || 0);
    if (price > 0 && amount > 0) setSubscriptionLessonCount(Math.max(2, Math.round(amount / price)));
    else updateSubscriptionPayHint();
});
document.getElementById('subscription-count-minus').onclick = () => setSubscriptionLessonCount(getSubscriptionLessonCount() - 1);
document.getElementById('subscription-count-plus').onclick = () => setSubscriptionLessonCount(getSubscriptionLessonCount() + 1);
document.getElementById('btn-subscription-pay-cancel').onclick = () => document.getElementById('subscription-pay-overlay').classList.add('hidden');
document.getElementById('btn-subscription-pay-apply').onclick = async () => {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const amount = Number(document.getElementById('subscription-pay-amount').value || 0);
    const lessonCount = getSubscriptionLessonCount();
    const sendReceipt = document.getElementById('subscription-send-receipt-checkbox').checked;
    const button = document.getElementById('btn-subscription-pay-apply');
    button.disabled = true;
    try {
        const response = await apiFetch('/pay_subscription', {
            method: 'POST',
            body: JSON.stringify({ date: lesson.date, id: lesson.id, amount, lesson_count: lessonCount, send_receipt: sendReceipt })
        });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка оплаты абонемента');
        document.getElementById('subscription-pay-overlay').classList.add('hidden');
        await Promise.all([refreshScheduleOnly(), refreshStudentsOnly()]);
        alert(`Абонемент оплачен: ${result.lessons_paid} занятий. Чек № ${result.receipt_number || '—'}. ${result.receipt_message || ''}`);
    } finally {
        button.disabled = false;
    }
};

document.getElementById('btn-paid-confirm-cancel').onclick = () => document.getElementById('paid-confirm-overlay').classList.add('hidden');
document.getElementById('btn-paid-confirm-apply').onclick = async () => {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const isGroup = lesson.lesson_type === 'group';
    const sendReceipt = document.getElementById('send-receipt-checkbox').checked;
    const button = document.getElementById('btn-paid-confirm-apply');
    const paidStudentIds = isGroup
        ? Array.from(document.querySelectorAll('#group-paid-members input[type="checkbox"]:checked')).map(input => input.value)
        : [];
    button.disabled = true;
    try {
        const response = await apiFetch('/mark_paid', {
            method: 'POST',
            body: JSON.stringify({ date: lesson.date, id: lesson.id, paid: true, send_receipt: sendReceipt, paid_student_ids: paidStudentIds })
        });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка изменения оплаты');
        document.getElementById('paid-confirm-overlay').classList.add('hidden');
        await refreshScheduleOnly();
        if (isGroup) alert(`Оплаты группы сохранены. ${result.receipt_message || ''}`);
        else alert(`Оплата отмечена. Чек № ${result.receipt_number || '—'}. ${result.receipt_message || ''}`);
    } finally {
        button.disabled = false;
    }
};
document.getElementById('btn-action-delete').onclick = () => { closeActionMenu(); document.getElementById('delete-modal-overlay').classList.remove('hidden'); };
document.getElementById('btn-action-close').onclick = closeActionMenu;

// Написать ученику
document.getElementById('btn-action-chat-student').onclick = () => {
    const id = state.selectedLesson?.student_id;
    const info = getStudentInfo(id);
    if (info.username) tg.openTelegramLink(`https://t.me/${info.username}`);
    else if (info.student_contacts && Object.keys(info.student_contacts).length) {
        const entries = Object.entries(info.student_contacts).filter(([, value]) => value);
        if (entries.length === 1) openContact(entries[0][0], entries[0][1]);
        else {
            const choice = prompt('Выберите контакт ученика:\n' + entries.map(([type, value], i) => `${i + 1}. ${type.toUpperCase()}: ${value}`).join('\n') + '\n\nВведите номер:');
            const idx = parseInt(choice, 10) - 1;
            if (idx >= 0 && idx < entries.length) openContact(entries[idx][0], entries[idx][1]);
        }
    } else if (id && !String(id).startsWith('manual')) tg.openTelegramLink(`tg://user?id=${id}`);
    else alert('Нет контакта ученика');
    closeActionMenu();
};

// Написать родителю (выбор мессенджера)
document.getElementById('btn-action-chat-parent').onclick = () => {
    const lesson = state.selectedLesson;
    const info = getStudentInfo(lesson?.student_id);
    const contacts = info.contacts || {};
    const available = Object.keys(contacts).filter(k => contacts[k]);
    
    if (available.length === 0) {
        alert('Нет сохранённых контактов родителя');
        closeActionMenu();
        return;
    }
    
    if (available.length === 1) {
        const type = available[0];
        const value = contacts[type];
        openContact(type, value);
        closeActionMenu();
        return;
    }
    
    // Если несколько — показываем выбор
    const menu = document.getElementById('action-menu-overlay');
    // Простой выбор через alert (можно расширить)
    const msg = 'Выберите мессенджер:\n' + available.map((t, i) => `${i+1}. ${t.toUpperCase()}: ${contacts[t]}`).join('\n');
    const choice = prompt(msg + '\n\nВведите номер:');
    if (choice) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < available.length) {
            const type = available[idx];
            openContact(type, contacts[type]);
        }
    }
    closeActionMenu();
};

function openContact(type, value) {
    switch(type) {
        case 'tg': {
            const clean = String(value).trim().replace('@', '');
            if (/^\d+$/.test(clean)) window.location.href = `tg://user?id=${clean}`;
            else tg.openTelegramLink(`https://t.me/${clean}`);
            break;
        }
        case 'wa':
            window.open(`https://wa.me/${value.replace(/[^0-9]/g, '')}`, '_blank');
            break;
        case 'phone':
            window.open(`tel:${value}`, '_blank');
            break;
        case 'max':
            alert(`Max: ${value}`);
            break;
        default:
            alert(`Контакт: ${value}`);
    }
}

// Удаление
document.getElementById('btn-delete-once').onclick = async () => {
    const l = state.selectedLesson;
    const response = await apiFetch('/delete_lesson', { method: 'POST', body: JSON.stringify({ date: l.date, id: l.id, delete_all: false }) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка удаления');
    closeAllModals();
    refreshScheduleOnly();
};
document.getElementById('btn-delete-all').onclick = async () => {
    const l = state.selectedLesson;
    const response = await apiFetch('/delete_lesson', { method: 'POST', body: JSON.stringify({ date: l.date, id: l.id, delete_all: true }) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка удаления');
    closeAllModals();
    refreshScheduleOnly();
};
document.getElementById('btn-delete-cancel').onclick = closeAllModals;

// Перенос
document.getElementById('btn-action-copy').onclick = () => executeMove('copy');
document.getElementById('btn-action-move-once').onclick = () => executeMove('move_once');
document.getElementById('btn-action-move-all').onclick = () => executeMove('move_all');
document.getElementById('btn-action-move-cancel').onclick = cancelMove;
document.getElementById('btn-cancel-move').onclick = cancelMove;

// Кнопки сохранения и закрытия
document.getElementById('btn-save').onclick = saveLesson;
document.getElementById('btn-cancel-modal').onclick = closeAllModals;
document.getElementById('btn-close-modal').onclick = closeAllModals;
['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'date-picker-overlay', 'app-settings-overlay', 'receipt-settings-overlay', 'student-card-overlay', 'work-center-overlay', 'paid-confirm-overlay', 'subscription-pay-overlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', event => { if (event.target.id === id) closeAllModals(); });
});

// Дата и навигация
function stripCloneIds(root) {
    if (root.id) root.removeAttribute('id');
    root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
}

function clearWeekDragStyles() {
    const grid = document.querySelector('#calendar-container > .calendar-grid');
    const header = document.getElementById('days-header');
    if (grid) {
        grid.style.transition = '';
        grid.style.transform = '';
        grid.style.willChange = '';
    }
    if (header) {
        header.style.transition = '';
        header.style.transform = '';
        header.style.willChange = '';
    }
}

function setWeekDragOffset(dx) {
    const grid = document.querySelector('#calendar-container > .calendar-grid');
    const header = document.getElementById('days-header');
    const offset = Math.max(-150, Math.min(150, dx * 0.48));
    const transform = `translate3d(${offset}px, 0, 0)`;
    if (grid) {
        grid.style.willChange = 'transform';
        grid.style.transform = transform;
    }
    if (header) {
        header.style.willChange = 'transform';
        header.style.transform = transform;
    }
}

function animateBackFromWeekDrag() {
    const grid = document.querySelector('#calendar-container > .calendar-grid');
    const header = document.getElementById('days-header');
    [grid, header].forEach(el => {
        if (!el) return;
        el.style.transition = 'transform 180ms cubic-bezier(.22,.61,.36,1)';
        el.style.transform = 'translate3d(0,0,0)';
    });
    window.setTimeout(clearWeekDragStyles, 200);
}

async function shiftWeek(days, { fromSwipe = false } = {}) {
    if (weekTransitioning || !days) return;
    weekTransitioning = true;

    const direction = days > 0 ? -1 : 1;
    const container = document.getElementById('calendar-container');
    const currentGrid = container.querySelector(':scope > .calendar-grid');
    const header = document.getElementById('days-header');
    const headerParent = header?.parentElement;

    const gridSnapshot = currentGrid?.cloneNode(true) || null;
    const headerSnapshot = header?.cloneNode(true) || null;
    if (gridSnapshot) {
        stripCloneIds(gridSnapshot);
        gridSnapshot.classList.add('week-slide-snapshot');
        gridSnapshot.style.transform = currentGrid.style.transform || 'translate3d(0,0,0)';
        container.appendChild(gridSnapshot);
    }
    if (headerSnapshot && headerParent) {
        stripCloneIds(headerSnapshot);
        headerSnapshot.classList.add('week-header-snapshot');
        headerSnapshot.style.transform = header.style.transform || 'translate3d(0,0,0)';
        headerParent.appendChild(headerSnapshot);
    }

    const targetMonday = new Date(state.currentMonday);
    targetMonday.setDate(targetMonday.getDate() + days);

    try {
        const data = await fetchWeekSchedule(targetMonday);
        state.currentMonday = targetMonday;
        state.schedule = data.schedule;
        clearWeekDragStyles();
        renderCalendar();

        const newGrid = container.querySelector(':scope > .calendar-grid');
        const newHeader = document.getElementById('days-header');
        const startX = direction * -100;
        const exitX = direction * 100;

        [newGrid, newHeader].forEach(el => {
            if (!el) return;
            el.style.transition = 'none';
            el.style.willChange = 'transform';
            el.style.transform = `translate3d(${startX}%,0,0)`;
        });

        // Два кадра гарантируют, что браузер увидит начальную позицию новой недели.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            [newGrid, newHeader].forEach(el => {
                if (!el) return;
                el.style.transition = 'transform 230ms cubic-bezier(.22,.61,.36,1)';
                el.style.transform = 'translate3d(0,0,0)';
            });
            [gridSnapshot, headerSnapshot].forEach(el => {
                if (!el) return;
                el.style.transition = 'transform 230ms cubic-bezier(.22,.61,.36,1)';
                el.style.transform = `translate3d(${exitX}%,0,0)`;
            });
        }));

        window.setTimeout(() => {
            gridSnapshot?.remove();
            headerSnapshot?.remove();
            clearWeekDragStyles();
            weekTransitioning = false;
        }, 270);
        scheduleWorkCenterRefresh();
    } catch (error) {
        console.error('Ошибка загрузки расписания:', error);
        gridSnapshot?.remove();
        headerSnapshot?.remove();
        animateBackFromWeekDrag();
        weekTransitioning = false;
    }
}

function openDatePicker() {
    const middle = new Date(state.currentMonday);
    middle.setDate(middle.getDate() + 3);
    state.datePickerMonth = new Date(middle.getFullYear(), middle.getMonth(), 1);
    renderDatePicker();
    document.getElementById('date-picker-overlay').classList.remove('hidden');
}

function renderDatePicker() {
    const base = new Date(state.datePickerMonth);
    const year = base.getFullYear();
    const month = base.getMonth();
    document.getElementById('date-picker-title').textContent = base.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const grid = document.getElementById('date-picker-grid');
    grid.innerHTML = '';

    const first = new Date(year, month, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - mondayOffset);
    const today = dateKey(new Date());

    for (let i = 0; i < 42; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'date-picker-day';
        if (date.getMonth() !== month) button.classList.add('other-month');
        if (dateKey(date) === today) button.classList.add('today');
        if (date >= state.currentMonday && date < new Date(state.currentMonday.getFullYear(), state.currentMonday.getMonth(), state.currentMonday.getDate() + 7)) button.classList.add('selected');
        button.textContent = date.getDate();
        button.onclick = () => {
            state.currentMonday = getMonday(date);
            document.getElementById('date-picker-overlay').classList.add('hidden');
            refreshScheduleOnly();
        };
        grid.appendChild(button);
    }
}

document.getElementById('month-label').onclick = openDatePicker;
document.getElementById('date-picker-prev').onclick = () => { state.datePickerMonth.setMonth(state.datePickerMonth.getMonth() - 1); renderDatePicker(); };
document.getElementById('date-picker-next').onclick = () => { state.datePickerMonth.setMonth(state.datePickerMonth.getMonth() + 1); renderDatePicker(); };
document.getElementById('date-picker-today').onclick = () => {
    const today = new Date();
    state.currentMonday = getMonday(today);
    document.getElementById('date-picker-overlay').classList.add('hidden');
    refreshScheduleOnly();
};
document.getElementById('date-picker-close').onclick = () => document.getElementById('date-picker-overlay').classList.add('hidden');

document.getElementById('btn-today').onclick = () => { state.currentMonday = getMonday(new Date()); refreshScheduleOnly(); };
document.getElementById('btn-prev-week').onclick = () => shiftWeek(-7);
document.getElementById('btn-next-week').onclick = () => shiftWeek(7);
document.getElementById('btn-zoom-in').onclick = () => applyHourHeightSmooth(Math.min(MAX_HOUR_HEIGHT, hourHeight + ZOOM_STEP));
document.getElementById('btn-zoom-out').onclick = () => applyHourHeightSmooth(Math.max(MIN_HOUR_HEIGHT, hourHeight - ZOOM_STEP));

async function downloadApiFile(path, options, fallbackFilename) {
    const response = await apiFetch(path, options || {});
    if (!response.ok) {
        let message = 'Не удалось скачать файл';
        try {
            const data = await response.json();
            message = data.message || message;
        } catch (_) {}
        throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
    let filename = fallbackFilename;
    if (match && match[1]) {
        try { filename = decodeURIComponent(match[1].replace(/\"/g, '').trim()); } catch (_) {}
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function runExportButton(button, workingText, action) {
    const original = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `<span class="settings-link-main"><strong>${workingText}</strong><small>Подождите немного…</small></span><span>…</span>`;
    try {
        await action();
    } catch (error) {
        alert(error.message || 'Ошибка экспорта');
    } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.innerHTML = original;
    }
}

async function sendExportToTelegram(path, options = {}) {
    const response = await apiFetch(path, options);
    let result = {};
    try { result = await response.json(); } catch (_) {}
    if (!response.ok || result.status !== 'ok') {
        throw new Error(result.message || 'Не удалось отправить файл в Telegram');
    }
    alert(result.message || 'Файл отправлен в Telegram.');
}

const btnDownloadBook = document.getElementById('btn-download-book');
btnDownloadBook.onclick = () => runExportButton(btnDownloadBook, 'Отправляю книгу учёта', async () => {
    await sendExportToTelegram('/download_book', { method: 'GET' });
});

const btnExportWeekPdf = document.getElementById('btn-export-week-pdf');
btnExportWeekPdf.onclick = () => runExportButton(btnExportWeekPdf, 'Отправляю PDF недели', async () => {
    const start = dateKey(state.currentMonday);
    await sendExportToTelegram('/export_week_pdf', {
        method: 'POST',
        body: JSON.stringify({ week_start: start })
    });
});

// Общие настройки и данные для чека
const receiptSettingFields = [
    'company_name', 'inn', 'ogrnip', 'address', 'phone', 'service_name', 'tax_system',
    'email_sender', 'thanks_text', 'website', 'bank_name', 'bik', 'account_number',
    'corr_account', 'recipient', 'payment_comment'
];

function fillAppSettingsForm() {
    document.getElementById('default-reminders-enabled').checked = state.settings.default_reminders_enabled !== false;
    document.getElementById('default-send-receipts').checked = state.settings.default_send_receipts !== false;
    document.getElementById('default-send-receipt-copy').checked = state.settings.default_send_receipt_copy !== false;
}

function fillReceiptSettingsForm() {
    receiptSettingFields.forEach(key => {
        const el = document.getElementById(`settings-${key}`);
        if (el) el.value = state.settings[key] || '';
    });
    document.getElementById('current-logo-name').textContent = state.settings.receipt_logo || 'не загружена';
    document.getElementById('current-signature-name').textContent = state.settings.receipt_signature || 'не загружена';
    document.getElementById('current-qrcode-name').textContent = state.settings.receipt_qrcode || 'не загружен';
}

async function uploadReceiptAsset(assetType, inputId) {
    const input = document.getElementById(inputId);
    if (!input || !input.files || !input.files[0]) return null;
    const formData = new FormData();
    formData.append('asset_type', assetType);
    formData.append('file', input.files[0]);
    const response = await apiFetch('/upload_receipt_asset', { method: 'POST', body: formData });
    const result = await response.json();
    if (result.status !== 'ok') throw new Error(result.message || 'Ошибка загрузки файла');
    return result.settings || null;
}

document.getElementById('btn-app-settings').onclick = () => {
    fillAppSettingsForm();
    document.getElementById('app-settings-overlay').classList.remove('hidden');
};
document.getElementById('btn-close-app-settings').onclick = () => document.getElementById('app-settings-overlay').classList.add('hidden');
document.getElementById('btn-cancel-app-settings').onclick = () => document.getElementById('app-settings-overlay').classList.add('hidden');
document.getElementById('btn-save-app-settings').onclick = async () => {
    const button = document.getElementById('btn-save-app-settings');
    button.disabled = true;
    try {
        const settings = {
            default_reminders_enabled: document.getElementById('default-reminders-enabled').checked,
            default_send_receipts: document.getElementById('default-send-receipts').checked,
            default_send_receipt_copy: document.getElementById('default-send-receipt-copy').checked
        };
        const response = await apiFetch('/update_settings', { method: 'POST', body: JSON.stringify(settings) });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения настроек');
        state.settings = result.settings || { ...state.settings, ...settings };
        document.getElementById('app-settings-overlay').classList.add('hidden');
    } catch (error) {
        alert(error.message || 'Ошибка сохранения настроек');
    } finally {
        button.disabled = false;
    }
};

document.getElementById('btn-open-receipt-settings').onclick = () => {
    fillReceiptSettingsForm();
    document.getElementById('app-settings-overlay').classList.add('hidden');
    document.getElementById('receipt-settings-overlay').classList.remove('hidden');
};
function closeReceiptSettings(openMain = true) {
    document.getElementById('receipt-settings-overlay').classList.add('hidden');
    if (openMain) document.getElementById('app-settings-overlay').classList.remove('hidden');
}
document.getElementById('btn-back-receipt-settings').onclick = () => closeReceiptSettings(true);
document.getElementById('btn-cancel-receipt-settings').onclick = () => closeReceiptSettings(true);
document.getElementById('btn-close-receipt-settings').onclick = () => closeReceiptSettings(false);
document.getElementById('btn-save-receipt-settings').onclick = async () => {
    const button = document.getElementById('btn-save-receipt-settings');
    button.disabled = true;
    try {
        const settings = {};
        receiptSettingFields.forEach(key => {
            const el = document.getElementById(`settings-${key}`);
            settings[key] = el ? el.value.trim() : '';
        });
        const response = await apiFetch('/update_settings', { method: 'POST', body: JSON.stringify(settings) });
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || 'Ошибка сохранения данных для чека');
        state.settings = result.settings || { ...state.settings, ...settings };
        for (const [type, inputId] of [['logo', 'settings-logo-file'], ['signature', 'settings-signature-file'], ['qrcode', 'settings-qrcode-file']]) {
            const updated = await uploadReceiptAsset(type, inputId);
            if (updated) state.settings = updated;
        }
        ['settings-logo-file', 'settings-signature-file', 'settings-qrcode-file'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
        fillReceiptSettingsForm();
        alert('Данные для чека сохранены');
    } catch (error) {
        alert(error.message || 'Ошибка сохранения данных для чека');
    } finally {
        button.disabled = false;
    }
};

// Карточка ученика: имя, стоимость, контакты и статистика оплат
async function loadStudentLessonStats(studentId) {
    const ratio = document.getElementById('student-lessons-ratio');
    const historyList = document.getElementById('student-history-list');
    const historySummary = document.getElementById('student-history-summary');
    ratio.textContent = '… / …';
    if (historyList) historyList.innerHTML = '<div class="student-history-empty">Загрузка…</div>';
    if (historySummary) historySummary.textContent = '';
    try {
        const response = await apiFetch('/get_student_stats', { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || 'Ошибка статистики');
        ratio.textContent = `${result.paid_lessons || 0} / ${result.conducted_lessons || 0}`;
        if (historySummary) historySummary.textContent = `${result.total_lessons || 0} всего`;
        if (historyList) {
            const history = Array.isArray(result.history) ? result.history : [];
            historyList.innerHTML = history.length ? history.map(item => {
                const dateLabel = shortDateRu(item.date);
                const paidLabel = item.paid ? '✓ оплачено' : 'не оплачено';
                return `<div class="student-history-row"><span>${escapeHtml(dateLabel)} · ${escapeHtml(item.time || '')}</span><span class="student-history-paid ${item.paid ? 'is-paid' : ''}">${paidLabel}</span></div>`;
            }).join('') : '<div class="student-history-empty">Занятий пока нет</div>';
        }
    } catch (error) {
        ratio.textContent = '— / —';
        if (historyList) historyList.innerHTML = '<div class="student-history-empty">Не удалось загрузить историю</div>';
    }
}

function setStudentStatus(status) {
    const normalized = status === 'paused' ? 'paused' : 'active';
    document.getElementById('student-card-overlay').dataset.studentStatus = normalized;
    document.getElementById('student-status-active').classList.toggle('active', normalized === 'active');
    document.getElementById('student-status-paused').classList.toggle('active', normalized === 'paused');
}

document.getElementById('student-status-active').onclick = () => setStudentStatus('active');
document.getElementById('student-status-paused').onclick = () => setStudentStatus('paused');

function openStudentCard(studentId) {
    if (!studentId || !state.students[studentId]) return alert('Карточка доступна после сохранения ученика.');
    const info = getStudentInfo(studentId);
    document.getElementById('student-card-overlay').dataset.studentId = studentId;
    document.getElementById('student-card-title').textContent = info.name || 'Ученик';
    document.getElementById('student-calendar-name').value = info.calendar_name || '';
    document.getElementById('student-birthday').value = info.birthday || '';
    document.getElementById('student-default-price').value = info.default_price || '';
    document.getElementById('student-note').value = info.note || '';
    setStudentStatus(info.status || 'active');
    renderContacts('student-card-student-contacts', info.student_contacts || {});
    renderContacts('student-card-parent-contacts', info.contacts || {});
    document.getElementById('student-card-overlay').classList.remove('hidden');
    loadStudentLessonStats(studentId);
}

document.getElementById('btn-close-student-card').onclick = () => document.getElementById('student-card-overlay').classList.add('hidden');
document.getElementById('btn-cancel-student-card').onclick = () => document.getElementById('student-card-overlay').classList.add('hidden');
document.getElementById('btn-save-student-card').onclick = async () => {
    const studentId = document.getElementById('student-card-overlay').dataset.studentId;
    const payload = {
        student_id: studentId,
        calendar_name: document.getElementById('student-calendar-name').value.trim(),
        birthday: document.getElementById('student-birthday').value,
        default_price: Number(document.getElementById('student-default-price').value || 0),
        status: document.getElementById('student-card-overlay').dataset.studentStatus || 'active',
        note: document.getElementById('student-note').value.trim(),
        student_contacts: getContacts('student-card-student-contacts'),
        contacts: getContacts('student-card-parent-contacts')
    };
    const response = await apiFetch('/update_student_profile', { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения ученика');
    state.students[studentId] = result.student;
    document.getElementById('student-card-overlay').classList.add('hidden');
    fillStudentsDropdown();
    renderCalendar();
    refreshWorkCenterBadge();
};

// Рабочий центр: внимание, окна, сводка и дни рождения
function shortDateRu(dateString) {
    const d = new Date(`${dateString}T12:00:00`);
    return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}
function money(value) { return `${Number(value || 0).toLocaleString('ru-RU')} ₽`; }
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

async function loadWorkCenter() {
    const response = await apiFetch('/get_work_center', {
        method: 'POST',
        body: JSON.stringify({ week_start: dateKey(state.currentMonday) })
    });
    const result = await response.json();
    if (result.status !== 'ok') throw new Error(result.message || 'Не удалось загрузить помощник');
    state.workCenter = result;
    renderWorkCenter();
    return result;
}

function renderWorkCenter() {
    const data = state.workCenter || { attention: [], windows: [], birthdays: [], summary: {} };
    document.getElementById('hub-attention-count').textContent = data.attention.length;
    const badge = document.getElementById('attention-badge');
    badge.textContent = data.attention.length;
    badge.classList.toggle('hidden', !data.attention.length);

    const attentionInfo = `<div class="hub-explainer"><strong>Что отслеживается</strong><span>Просроченные неоплаченные занятия · дни рождения в ближайшие 7 дней · задолженность, если она сохранена в данных ученика.</span></div>`;
    document.getElementById('hub-attention').innerHTML = attentionInfo + (data.attention.length
        ? data.attention.map(item => `<div class="hub-item">${escapeHtml(item.text || '')}</div>`).join('')
        : '<div class="hub-empty">Сейчас всё спокойно — ничего из этого не требует внимания.</div>');

    document.getElementById('hub-windows').innerHTML = data.windows.length
        ? data.windows.map(item => `<div class="hub-item"><strong>${shortDateRu(item.date)}</strong><span>${item.from}–${item.to}</span></div>`).join('')
        : '<div class="hub-empty">Свободных окон от 60 минут нет.</div>';

    const summary = data.summary || {};
    document.getElementById('hub-summary').innerHTML = `
        <div class="summary-grid">
            <div><small>Занятий</small><strong>${summary.lessons || 0}</strong></div>
            <div><small>Оплачено</small><strong>${summary.paid || 0}</strong></div>
            <div><small>План</small><strong>${money(summary.planned_sum)}</strong></div>
            <div><small>Получено</small><strong>${money(summary.paid_sum)}</strong></div>
        </div>`;

    document.getElementById('hub-birthdays').innerHTML = data.birthdays.length
        ? data.birthdays.map(item => `<div class="hub-item"><strong>${escapeHtml(item.name)}</strong><span>${item.days === 0 ? 'сегодня' : `${shortDateRu(item.date)} · через ${item.days} дн.`}</span></div>`).join('')
        : '<div class="hub-empty">В ближайшие 30 дней дней рождения нет.</div>';
}

async function refreshWorkCenterBadge() {
    try { await loadWorkCenter(); } catch (e) { console.warn('Помощник недоступен:', e); }
}

document.getElementById('btn-work-center').onclick = async () => {
    document.getElementById('work-center-overlay').classList.remove('hidden');
    document.querySelectorAll('.hub-panel').forEach(el => el.classList.add('hidden'));
    try { await loadWorkCenter(); } catch (e) { alert(e.message); }
};
document.getElementById('btn-close-work-center').onclick = () => document.getElementById('work-center-overlay').classList.add('hidden');
document.getElementById('btn-close-work-center-bottom').onclick = () => document.getElementById('work-center-overlay').classList.add('hidden');
document.querySelectorAll('.hub-row').forEach(row => {
    row.onclick = () => {
        const target = document.getElementById(`hub-${row.dataset.hubSection}`);
        const wasHidden = target.classList.contains('hidden');
        document.querySelectorAll('.hub-panel').forEach(panel => panel.classList.add('hidden'));
        if (wasHidden) target.classList.remove('hidden');
    };
});

// Плавный pinch-зум + живое перелистывание недель одним пальцем
let pinchStartDistance = null;
let pinchStartHeight = hourHeight;
let pinchAnchorHours = null;
let pinchAnchorLocalY = null;
let pendingPinchHeight = null;
let pinchFrame = null;
let swipeStartX = null;
let swipeStartY = null;
let swipeTracking = false;
let swipeHorizontal = false;
const calendarContainer = document.getElementById('calendar-container');

function applyHourHeightSmooth(nextHeight) {
    hourHeight = Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, nextHeight));
    document.documentElement.style.setProperty('--hour-height', `${hourHeight}px`);

    document.querySelectorAll('#events-layer .event-card').forEach(card => {
        const startMinutes = Number(card.dataset.startMinutes || 0);
        const duration = Number(card.dataset.durationMinutes || 60);
        card.style.top = `${startMinutes * hourHeight / 60}px`;
        card.style.height = `${Math.max(18, duration * hourHeight / 60 - 2)}px`;
    });

    if (pinchAnchorHours !== null && pinchAnchorLocalY !== null) {
        calendarContainer.scrollTop = Math.max(0, pinchAnchorHours * hourHeight - pinchAnchorLocalY);
    }
    updateCurrentTimeLine();
}

function schedulePinchHeight(nextHeight) {
    pendingPinchHeight = nextHeight;
    if (pinchFrame !== null) return;
    pinchFrame = requestAnimationFrame(() => {
        pinchFrame = null;
        if (pendingPinchHeight !== null) applyHourHeightSmooth(pendingPinchHeight);
        pendingPinchHeight = null;
    });
}

function finishPinch() {
    if (pinchFrame !== null) {
        cancelAnimationFrame(pinchFrame);
        pinchFrame = null;
    }
    if (pendingPinchHeight !== null) {
        applyHourHeightSmooth(pendingPinchHeight);
        pendingPinchHeight = null;
    }
    pinchStartDistance = null;
    pinchAnchorHours = null;
    pinchAnchorLocalY = null;
}

calendarContainer.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
        swipeTracking = false;
        swipeHorizontal = false;
        swipeStartX = null;
        const a = event.touches[0];
        const b = event.touches[1];
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        pinchStartDistance = Math.hypot(dx, dy);
        pinchStartHeight = hourHeight;
        const rect = calendarContainer.getBoundingClientRect();
        const midpointY = (a.clientY + b.clientY) / 2;
        pinchAnchorLocalY = midpointY - rect.top;
        pinchAnchorHours = (calendarContainer.scrollTop + pinchAnchorLocalY) / pinchStartHeight;
        return;
    }
    if (event.touches.length === 1 && !state.isMoving && !weekTransitioning && !event.target.closest('.event-card')) {
        finishPinch();
        swipeStartX = event.touches[0].clientX;
        swipeStartY = event.touches[0].clientY;
        swipeTracking = true;
        swipeHorizontal = false;
    }
}, { passive: true });

calendarContainer.addEventListener('touchmove', event => {
    if (event.touches.length === 2 && pinchStartDistance !== null) {
        event.preventDefault();
        const a = event.touches[0];
        const b = event.touches[1];
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const ratio = distance / Math.max(1, pinchStartDistance);
        // Нелинейная чувствительность: небольшое движение пальцев уже заметно, но без скачков.
        const nextHeight = pinchStartHeight * Math.pow(ratio, 0.88);
        schedulePinchHeight(nextHeight);
        return;
    }
    if (event.touches.length === 1 && swipeTracking && swipeStartX !== null) {
        const dx = event.touches[0].clientX - swipeStartX;
        const dy = event.touches[0].clientY - swipeStartY;
        if (!swipeHorizontal && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) swipeHorizontal = true;
        if (swipeHorizontal) {
            event.preventDefault();
            setWeekDragOffset(dx);
        }
    }
}, { passive: false });

calendarContainer.addEventListener('touchend', event => {
    if (event.touches.length < 2 && pinchStartDistance !== null) finishPinch();
    if (!swipeTracking || swipeStartX === null || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - swipeStartX;
    const dy = event.changedTouches[0].clientY - swipeStartY;
    swipeTracking = false;
    swipeStartX = null;
    swipeStartY = null;
    const shouldShift = swipeHorizontal && Math.abs(dx) >= 58 && Math.abs(dx) > Math.abs(dy) * 1.18;
    swipeHorizontal = false;
    if (shouldShift) {
        haptic('light');
        shiftWeek(dx < 0 ? 7 : -7, { fromSwipe: true });
    } else {
        animateBackFromWeekDrag();
    }
});

calendarContainer.addEventListener('touchcancel', () => {
    finishPinch();
    swipeTracking = false;
    swipeHorizontal = false;
    swipeStartX = null;
    swipeStartY = null;
    animateBackFromWeekDrag();
});

window.addEventListener('resize', () => requestAnimationFrame(() => renderCalendar()));
fetchData();