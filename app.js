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
    editingExisting: false,
    settings: { default_reminders_enabled: true, default_send_receipts: true },
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

async function fetchData() {
    try {
        const scheduleResponse = await apiFetch('/get_week_schedule', {
            method: 'POST',
            body: JSON.stringify({ week_start: dateKey(state.currentMonday) })
        });
        const scheduleData = await scheduleResponse.json();
        if (scheduleData.status !== 'ok') throw new Error(scheduleData.message || 'Ошибка расписания');
        state.schedule = scheduleData.schedule || {};

        const studentsResponse = await apiFetch('/get_students');
        const studentsData = await studentsResponse.json();
        state.students = studentsData.students || {};

        try {
            const settingsResponse = await apiFetch('/get_settings');
            if (settingsResponse.ok) {
                const settingsData = await settingsResponse.json();
                if (settingsData.status === 'ok') state.settings = settingsData.settings || state.settings;
            }
        } catch (settingsError) {
            console.warn('Настройки пока недоступны:', settingsError);
        }

        fillStudentsDropdown();
        renderCalendar();
        refreshWorkCenterBadge();
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

function groupMemberOptions(selectedId = '') {
    const options = ['<option value="">-- Выбрать ученика --</option>', '<option value="manual">Вписать вручную...</option>'];
    Object.entries(state.students).forEach(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
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
    document.getElementById('student-contacts-group').classList.add('hidden');
    const parentContactsGroup = document.getElementById('parent-contacts-container')?.closest('.form-group');
    if (parentContactsGroup) parentContactsGroup.classList.toggle('hidden', isGroup);
    const priceLabel = document.getElementById('lesson-price-label');
    if (priceLabel) priceLabel.textContent = isGroup ? 'Стоимость с ученика (руб.)' : 'Стоимость урока (руб.)';
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

            const title = document.createElement('div');
            title.className = 'event-title';
            title.textContent = isGroup ? (lesson.group_name || lesson.student || 'Группа') : (lesson.student || 'Ученик');
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
    document.getElementById('student-contacts-group').classList.add('hidden');
    renderContacts('student-contacts-container', {});
    renderContacts('parent-contacts-container', {});
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
    document.getElementById('lesson-price').value = '';
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
    const isManualStudent = !isGroup && String(lesson.student_id || '').startsWith('manual');
    document.getElementById('student-contacts-group').classList.toggle('hidden', !isManualStudent);
    document.getElementById('fixed-student-name').value = lesson.student || '';
    updateLessonTypeUI();
    if (!isGroup && isManualStudent) document.getElementById('student-contacts-group').classList.remove('hidden');
    document.getElementById('time-duration-group').classList.add('hidden');
    document.getElementById('repeat-group').classList.add('hidden');
    document.getElementById('lesson-date').value = date;
    document.getElementById('lesson-time').value = lesson.time || '10:00';
    document.getElementById('lesson-duration').value = lesson.duration || 60;
    document.getElementById('lesson-id').value = lesson.id || '';
    document.getElementById('lesson-price').value = lesson.price || '';
    document.getElementById('reminder-enabled').checked = lesson.reminder_enabled !== false;
    document.getElementById('reminder-minutes').value = lesson.reminder_minutes ?? 60;
    document.getElementById('reminder-text').value = lesson.reminder_text || '';
    document.getElementById('zoom-link').value = lesson.zoom_link || '';

    const info = getStudentInfo(lesson.student_id);
    renderContacts('parent-contacts-container', info.contacts || lesson.contacts || {});
    renderContacts('student-contacts-container', isManualStudent ? (info.student_contacts || {}) : {});
    updateReminderControls();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

async function saveLesson() {
    const date = document.getElementById('lesson-date').value;
    const time = document.getElementById('lesson-time').value;
    const duration = parseInt(document.getElementById('lesson-duration').value || 60, 10);
    const price = document.getElementById('lesson-price').value;
    const lessonType = document.getElementById('lesson-type-select').value === 'group' ? 'group' : 'student';
    const contacts = getContacts('parent-contacts-container');
    const studentContacts = getContacts('student-contacts-container');
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
        price, contacts, student_contacts: studentContacts,
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
    fetchData();
}

function closeAllModals() {
    ['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'date-picker-overlay', 'app-settings-overlay', 'receipt-settings-overlay', 'student-card-overlay', 'work-center-overlay', 'paid-confirm-overlay'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
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
                fetchData();
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
        fetchData();
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
    document.getElementById('student-contacts-group').classList.toggle('hidden', !manual);
    if (manual) {
        renderContacts('student-contacts-container', {});
        input.focus();
    }
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
        fetchData();
        return;
    }

    document.getElementById('paid-confirm-title').textContent = `${isGroup ? (lesson.group_name || 'Группа') : (lesson.student || 'Ученик')} · ${lesson.time || '--:--'}`;
    document.getElementById('paid-confirm-desc').textContent = isGroup
        ? `Отметьте учеников, которые оплатили${lesson.price ? ` по ${lesson.price} руб.` : ''}.`
        : `Подтвердить оплату${lesson.price ? ` на ${lesson.price} руб.` : ''}?`;
    const membersBox = document.getElementById('group-paid-members');
    membersBox.innerHTML = '';
    membersBox.classList.toggle('hidden', !isGroup);
    if (isGroup) {
        (lesson.group_members || []).forEach(member => {
            const label = document.createElement('label');
            label.className = 'group-paid-member-row';
            label.innerHTML = `<input type="checkbox" value="${escapeHtml(member.student_id || '')}" ${member.paid ? 'checked' : ''}><span>${escapeHtml(member.name || 'Ученик')}</span>`;
            membersBox.appendChild(label);
        });
    }
    document.getElementById('send-receipt-checkbox').checked = state.settings.default_send_receipts !== false;
    closeActionMenu();
    document.getElementById('paid-confirm-overlay').classList.remove('hidden');
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
        await fetchData();
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
    fetchData();
};
document.getElementById('btn-delete-all').onclick = async () => {
    const l = state.selectedLesson;
    const response = await apiFetch('/delete_lesson', { method: 'POST', body: JSON.stringify({ date: l.date, id: l.id, delete_all: true }) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка удаления');
    closeAllModals();
    fetchData();
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
['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'date-picker-overlay', 'app-settings-overlay', 'receipt-settings-overlay', 'student-card-overlay', 'work-center-overlay', 'paid-confirm-overlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', event => { if (event.target.id === id) closeAllModals(); });
});

// Дата и навигация
function shiftWeek(days) {
    state.currentMonday.setDate(state.currentMonday.getDate() + days);
    fetchData();
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
            fetchData();
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
    fetchData();
};
document.getElementById('date-picker-close').onclick = () => document.getElementById('date-picker-overlay').classList.add('hidden');

document.getElementById('btn-today').onclick = () => { state.currentMonday = getMonday(new Date()); fetchData(); };
document.getElementById('btn-prev-week').onclick = () => shiftWeek(-7);
document.getElementById('btn-next-week').onclick = () => shiftWeek(7);
document.getElementById('btn-zoom-in').onclick = () => { hourHeight = Math.min(MAX_HOUR_HEIGHT, hourHeight + ZOOM_STEP); renderCalendar(); };
document.getElementById('btn-zoom-out').onclick = () => { hourHeight = Math.max(MIN_HOUR_HEIGHT, hourHeight - ZOOM_STEP); renderCalendar(); };

// Общие настройки и данные для чека
const receiptSettingFields = [
    'company_name', 'inn', 'ogrnip', 'address', 'phone', 'service_name', 'tax_system',
    'email_sender', 'thanks_text', 'website', 'bank_name', 'bik', 'account_number',
    'corr_account', 'recipient', 'payment_comment'
];

function fillAppSettingsForm() {
    document.getElementById('default-reminders-enabled').checked = state.settings.default_reminders_enabled !== false;
    document.getElementById('default-send-receipts').checked = state.settings.default_send_receipts !== false;
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
            default_send_receipts: document.getElementById('default-send-receipts').checked
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

// Карточка ученика: баланс, абонемент, день рождения
function updateStudentCardPreview() {
    const balance = Number(document.getElementById('student-balance').value || 0);
    const enabled = document.getElementById('student-subscription-enabled').checked;
    const remaining = Number(document.getElementById('student-subscription-remaining').value || 0);
    const total = Number(document.getElementById('student-subscription-total').value || 0);
    document.getElementById('student-balance-preview').textContent = `${balance > 0 ? '+' : ''}${balance.toLocaleString('ru-RU')} ₽`;
    document.getElementById('student-subscription-preview').textContent = enabled ? `${remaining} из ${total || '—'}` : '—';
    document.getElementById('student-subscription-fields').classList.toggle('hidden', !enabled);
}

function openStudentCard(studentId) {
    if (!studentId || !state.students[studentId]) return alert('Карточка доступна после сохранения ученика.');
    const info = getStudentInfo(studentId);
    document.getElementById('student-card-overlay').dataset.studentId = studentId;
    document.getElementById('student-card-title').textContent = info.name || 'Ученик';
    document.getElementById('student-birthday').value = info.birthday || '';
    document.getElementById('student-balance').value = info.balance ?? 0;
    document.getElementById('student-subscription-enabled').checked = info.subscription_enabled === true;
    document.getElementById('student-subscription-total').value = info.subscription_total || '';
    document.getElementById('student-subscription-remaining').value = info.subscription_remaining ?? '';
    document.getElementById('student-subscription-price').value = info.subscription_price || '';
    updateStudentCardPreview();
    document.getElementById('student-card-overlay').classList.remove('hidden');
}
['student-balance', 'student-subscription-total', 'student-subscription-remaining'].forEach(id => document.getElementById(id).addEventListener('input', updateStudentCardPreview));
document.getElementById('student-subscription-enabled').addEventListener('change', updateStudentCardPreview);
document.getElementById('btn-close-student-card').onclick = () => document.getElementById('student-card-overlay').classList.add('hidden');
document.getElementById('btn-cancel-student-card').onclick = () => document.getElementById('student-card-overlay').classList.add('hidden');
document.getElementById('btn-save-student-card').onclick = async () => {
    const studentId = document.getElementById('student-card-overlay').dataset.studentId;
    const payload = {
        student_id: studentId,
        birthday: document.getElementById('student-birthday').value,
        balance: Number(document.getElementById('student-balance').value || 0),
        subscription_enabled: document.getElementById('student-subscription-enabled').checked,
        subscription_total: Number(document.getElementById('student-subscription-total').value || 0),
        subscription_remaining: Number(document.getElementById('student-subscription-remaining').value || 0),
        subscription_price: Number(document.getElementById('student-subscription-price').value || 0)
    };
    const response = await apiFetch('/update_student_profile', { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения ученика');
    state.students[studentId] = result.student;
    document.getElementById('student-card-overlay').classList.add('hidden');
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

    document.getElementById('hub-attention').innerHTML = data.attention.length
        ? data.attention.map(item => `<div class="hub-item">${escapeHtml(item.text || '')}</div>`).join('')
        : '<div class="hub-empty">Всё спокойно — ничего срочного.</div>';

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

// Pinch + перелистывание недель одним пальцем
let pinchStartY = null;
let pinchStartHeight = hourHeight;
let swipeStartX = null;
let swipeStartY = null;
let swipeTracking = false;
const calendarContainer = document.getElementById('calendar-container');

calendarContainer.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
        swipeTracking = false;
        swipeStartX = null;
        pinchStartY = Math.abs(event.touches[0].clientY - event.touches[1].clientY);
        pinchStartHeight = hourHeight;
        return;
    }
    if (event.touches.length === 1 && !state.isMoving && !event.target.closest('.event-card')) {
        pinchStartY = null;
        swipeStartX = event.touches[0].clientX;
        swipeStartY = event.touches[0].clientY;
        swipeTracking = true;
    }
}, { passive: true });

calendarContainer.addEventListener('touchmove', event => {
    if (event.touches.length === 2 && pinchStartY !== null) {
        event.preventDefault();
        const currentY = Math.abs(event.touches[0].clientY - event.touches[1].clientY);
        const difference = currentY - pinchStartY;
        hourHeight = Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, pinchStartHeight + difference * 0.6));
        renderCalendar();
        return;
    }
    if (event.touches.length === 1 && swipeTracking && swipeStartX !== null) {
        const dx = event.touches[0].clientX - swipeStartX;
        const dy = event.touches[0].clientY - swipeStartY;
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) event.preventDefault();
    }
}, { passive: false });

calendarContainer.addEventListener('touchend', event => {
    if (event.touches.length < 2) pinchStartY = null;
    if (!swipeTracking || swipeStartX === null || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - swipeStartX;
    const dy = event.changedTouches[0].clientY - swipeStartY;
    swipeTracking = false;
    swipeStartX = null;
    swipeStartY = null;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        haptic('light');
        shiftWeek(dx < 0 ? 7 : -7);
    }
});

window.addEventListener('resize', () => requestAnimationFrame(() => renderCalendar()));
fetchData();