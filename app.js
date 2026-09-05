const tg = window.Telegram.WebApp;
tg.expand();

// Keep dialogs inside the visible WebView, including when the keyboard reduces it.
function updateModalViewport() {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty('--modal-viewport-height', `${viewport ? viewport.height : window.innerHeight}px`);
    document.documentElement.style.setProperty('--modal-viewport-top', `${viewport ? viewport.offsetTop : 0}px`);
}
updateModalViewport();
window.addEventListener('resize', updateModalViewport);
window.visualViewport?.addEventListener('resize', updateModalViewport);
window.visualViewport?.addEventListener('scroll', updateModalViewport);

const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';
let START_HOUR = 10;
let END_HOUR = 21;
const MIN_HOUR_HEIGHT = 40;
const MAX_HOUR_HEIGHT = 160;
const DEFAULT_HOUR_HEIGHT = 80;
const ZOOM_STEP = 20;

let hourHeight = DEFAULT_HOUR_HEIGHT;
let weekTransitioning = false;
let autoFitWeekPending = true;

const state = {
    currentMonday: getMonday(new Date()),
    schedule: {},
    students: {},
    selectedLesson: null,
    isMoving: false,
    pendingMove: null,
    editingExisting: false,
    settings: { default_reminders_enabled: true, default_send_receipts: true, default_send_receipt_copy: true, zoom_link: '', work_start: '10:00', work_end: '21:00' },
    datePickerMonth: new Date(),
    workCenter: null,
    subscriptionStudentId: '',
    subscriptionPrice: 0
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

function formatWeekRange(monday) {
    const months = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'нояб.', 'дек.'];
    const start = new Date(monday);
    const end = new Date(monday);
    end.setDate(end.getDate() + 6);
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return `${start.getDate()}–${end.getDate()} ${months[end.getMonth()]}`;
    }
    return `${start.getDate()} ${months[start.getMonth()]}–${end.getDate()} ${months[end.getMonth()]}`;
}

function haptic(type = 'light') {
    try { tg.HapticFeedback.impactOccurred(type); } catch (e) {}
}

function getStudentInfo(studentId) {
    const raw = state.students[studentId];
    return typeof raw === 'string' ? { name: raw } : (raw || {});
}

function teacherTelegramId() {
    return String(tg?.initDataUnsafe?.user?.id || '');
}

function visibleStudentEntries() {
    const teacherId = teacherTelegramId();
    return Object.entries(state.students)
        .filter(([id]) => String(id) !== teacherId)
        .sort((a, b) => {
            const aInfo = typeof a[1] === 'string' ? { name: a[1] } : (a[1] || {});
            const bInfo = typeof b[1] === 'string' ? { name: b[1] } : (b[1] || {});
            return String(aInfo.name || a[0]).localeCompare(String(bInfo.name || b[0]), 'ru', { sensitivity: 'base' });
        });
}

function lessonPriceValue(lesson, member = null) {
    const raw = member ? (member.price ?? lesson?.price) : lesson?.price;
    const value = Number(raw || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function updateVisibleHoursFromSettingsAndLessons() {
    const parseHour = (value, fallback) => {
        const [h] = String(value || '').split(':').map(Number);
        return Number.isFinite(h) ? h : fallback;
    };
    let start = parseHour(state.settings.work_start, 10);
    let end = parseHour(state.settings.work_end, 21);
    const endMinutesSetting = (() => {
        const [h, m] = String(state.settings.work_end || '21:00').split(':').map(Number);
        return (Number.isFinite(h) ? h : 21) * 60 + (Number.isFinite(m) ? m : 0);
    })();
    if (end <= start && endMinutesSetting <= start * 60) { start = 10; end = 21; }
    let visibleStart = start;
    let visibleEndExclusive = end;
    Object.values(state.schedule || {}).forEach(lessons => (lessons || []).forEach(lesson => {
        const [h, m] = String(lesson.time || '').split(':').map(Number);
        if (!Number.isFinite(h)) return;
        const duration = Math.max(5, Number(lesson.duration || 60));
        const startMinutes = h * 60 + (Number.isFinite(m) ? m : 0);
        const endMinutes = startMinutes + duration;
        visibleStart = Math.min(visibleStart, Math.floor(startMinutes / 60));
        visibleEndExclusive = Math.max(visibleEndExclusive, Math.ceil(endMinutes / 60));
    }));
    START_HOUR = Math.max(0, visibleStart);
    END_HOUR = Math.min(23, Math.max(START_HOUR, visibleEndExclusive - 1));
}

function schoolYearEndFor(dateValue) {
    const d = dateValue ? new Date(`${dateValue}T12:00:00`) : new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const targetYear = month <= 5 ? year : year + 1;
    return `${targetYear}-05-31`;
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
        if (data.status === 'ok') { state.settings = data.settings || state.settings; updateVisibleHoursFromSettingsAndLessons(); }
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

    visibleStudentEntries().forEach(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
        if (info.status === 'paused' || info.archived) return;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = info.name || id;
        option.dataset.name = info.name || id;
        select.appendChild(option);
    });
}

function groupMemberOptions(selectedId = '') {
    const options = ['<option value="">-- Выбрать ученика --</option>', '<option value="manual">Вписать вручную...</option>'];
    visibleStudentEntries().forEach(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
        if ((info.status === 'paused' || info.archived) && String(id) !== String(selectedId)) return;
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
        <input type="number" class="group-member-price" min="0" step="1" inputmode="decimal" placeholder="Цена, ₽" value="${escapeHtml(member?.price ?? '')}">
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
        const priceInput = row.querySelector('.group-member-price');
        const price = Number(priceInput?.value || 0);
        if (!select?.value) return;
        if (select.value === 'manual') {
            const name = manualInput?.value.trim() || '';
            if (name) result.push({ student_id: 'manual', name, price: price > 0 ? price : '' });
        } else {
            const option = select.options[select.selectedIndex];
            result.push({ student_id: select.value, name: option?.dataset.name || option?.textContent || select.value, price: price > 0 ? price : '' });
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
    document.getElementById('student-lesson-price-group')?.classList.toggle('hidden', isGroup);
}

function lessonBoundsForCurrentWeek() {
    let earliest = null;
    let latest = null;

    Object.values(state.schedule || {}).forEach(lessons => {
        (lessons || []).forEach(lesson => {
            const [hourRaw, minuteRaw] = String(lesson.time || '').split(':');
            const hour = Number(hourRaw);
            const minute = Number(minuteRaw);
            if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;

            const start = hour * 60 + minute;
            if (start < START_HOUR * 60 || start > END_HOUR * 60 + 59) return;
            const duration = Math.max(1, Number(lesson.duration || 60));
            const end = Math.min((END_HOUR + 1) * 60, start + duration);

            earliest = earliest === null ? start : Math.min(earliest, start);
            latest = latest === null ? end : Math.max(latest, end);
        });
    });

    return earliest === null || latest === null ? null : { earliest, latest };
}

function autoFitCalendarToWeek() {
    if (!autoFitWeekPending) return;
    autoFitWeekPending = false;

    const container = document.getElementById('calendar-container');
    if (!container) return;

    const bounds = lessonBoundsForCurrentWeek();
    if (!bounds) {
        applyHourHeightSmooth(DEFAULT_HOUR_HEIGHT);
        container.scrollTop = 0;
        return;
    }

    // Небольшой воздух сверху/снизу, чтобы первое и последнее занятие не прилипали к краям.
    const paddingMinutes = 15;
    const visibleStart = Math.max(START_HOUR * 60, bounds.earliest - paddingMinutes);
    const visibleEnd = Math.min((END_HOUR + 1) * 60, bounds.latest + paddingMinutes);
    const spanMinutes = Math.max(60, visibleEnd - visibleStart);
    const viewportHeight = Math.max(1, container.clientHeight - 12);

    // Автоподбор только сжимает стандартный масштаб. Если диапазон небольшой,
    // привычный масштаб 80 px/час сохраняется и календарь просто прокручивается к первому уроку.
    const fitHeight = viewportHeight * 60 / spanMinutes;
    const targetHeight = Math.max(MIN_HOUR_HEIGHT, Math.min(DEFAULT_HOUR_HEIGHT, fitHeight));
    applyHourHeightSmooth(targetHeight);

    const offsetMinutes = Math.max(0, visibleStart - START_HOUR * 60);
    const desiredTop = offsetMinutes * hourHeight / 60;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.min(maxScroll, Math.max(0, desiredTop));
}

function scheduleCalendarAutoFit() {
    requestAnimationFrame(() => requestAnimationFrame(autoFitCalendarToWeek));
}

function renderCalendar() {
    updateVisibleHoursFromSettingsAndLessons();
    const labels = document.getElementById('time-labels');
    const grid = document.getElementById('week-grid');
    const layer = document.getElementById('events-layer');
    if (!labels || !grid || !layer) return;

    labels.innerHTML = '';
    grid.innerHTML = '';
    layer.innerHTML = '<div id="current-time-line" class="current-time-line hidden"><div class="time-line-dot"></div></div>';
    document.documentElement.style.setProperty('--hour-height', `${hourHeight}px`);

    document.getElementById('month-label').title = `Выбрать дату · ${formatWeekRange(state.currentMonday)}`;

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
            const groupPaidCount = groupMembers.filter(member => member.paid || member.free).length;
            const partiallyPaid = isGroup && groupPaidCount > 0 && groupPaidCount < groupMembers.length;
            card.className = `event-card ${colorClass} ${lesson.paid ? 'paid-status' : ''} ${partiallyPaid ? 'partial-paid-status' : ''} ${isGroup ? 'group-event' : ''} ${lesson.cancelled ? 'cancelled-event' : ''} ${isActiveMove ? 'moving-active' : ''}`;
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

    if (autoFitWeekPending) scheduleCalendarAutoFit();
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

function lessonHasStarted(date, lesson) {
    const start = new Date(`${date}T${lesson.time || '00:00'}:00`);
    return !Number.isNaN(start.getTime()) && start.getTime() <= Date.now();
}

function openActionMenu(date, lesson) {
    state.selectedLesson = { date, ...lesson };
    const isGroup = lesson.lesson_type === 'group';
    const cancelled = !!lesson.cancelled;
    document.getElementById('action-contact-label').textContent = isGroup ? 'Участники' : 'Связь';
    document.getElementById('action-menu-title').textContent = `${isGroup ? (lesson.group_name || lesson.student || 'Группа') : (lesson.student || 'Ученик')} · ${lesson.time || '--:--'}`;

    const paidButton = document.getElementById('btn-action-paid');
    paidButton.textContent = paymentActionLabel(lesson);
    document.getElementById('individual-payment-label').classList.toggle('hidden', isGroup);
    paidButton.classList.toggle('hidden', cancelled || isGroup);

    document.getElementById('btn-action-student-card').classList.toggle('hidden', isGroup);
    document.getElementById('btn-action-chat-student').classList.toggle('hidden', isGroup);
    document.getElementById('btn-action-chat-parent').classList.toggle('hidden', isGroup);
    document.getElementById('btn-action-chat-student').textContent = '💬 Написать ученику';
    document.getElementById('btn-action-chat-parent').textContent = '💬 Написать родителю';
    document.getElementById('btn-action-subscription').classList.toggle('hidden', cancelled || isGroup);
    document.getElementById('btn-action-free').classList.toggle('hidden', cancelled || isGroup);
    document.getElementById('btn-action-free').textContent = lesson.free ? '↩ Отменить бесплатно' : '🎁 Бесплатно';
    document.getElementById('btn-action-cancel-once').textContent = cancelled ? '↩️ Вернуть занятие' : '🚫 Отменить';
    document.getElementById('btn-action-report').classList.toggle('hidden', cancelled || !lessonHasStarted(date, lesson));
    const settingsButton = document.getElementById('btn-action-settings');
    settingsButton.textContent = isGroup ? '✏️ Редактировать группу' : '⚙️ Настройки занятия';

    const details = document.getElementById('group-action-details');
    details.innerHTML = '';
    details.classList.toggle('hidden', !isGroup);
    if (isGroup) {
        (lesson.group_members || []).forEach(member => {
            const row = document.createElement('div');
            row.className = 'group-action-member';
            const price = lessonPriceValue(lesson, member);
            const statusClass = member.free ? 'is-free' : (member.paid ? 'is-paid' : 'is-debt');
            const status = paymentStatusLabel(member);
            row.innerHTML = `
                <button type="button" class="group-action-member-head" aria-expanded="false">
                    <strong>${escapeHtml(member.name || 'Ученик')}</strong>
                    <span class="group-member-summary">${price > 0 ? `${price.toLocaleString('ru-RU')} ₽` : 'цена —'} <i class="group-member-status ${statusClass}">${status}</i> <b>›</b></span>
                </button>
                <div class="group-member-actions hidden">
                    <div class="action-section-label">Связь</div>
                    <button type="button" data-member-action="student-chat">💬 Написать ученику</button>
                    <button type="button" data-member-action="parent-chat">💬 Написать родителю</button>
                    <div class="action-section-label">Оплата</div>
                    <div class="group-member-payment-row">
                    <button type="button" data-member-action="paid">${paymentActionLabel(member)}</button>
                    <button type="button" data-member-action="subscription">🎟 Абонемент</button>
                    <button type="button" data-member-action="free">${member.free ? '↩ Отменить бесплатно' : '🎁 Бесплатно'}</button>
                    </div>
                    <div class="action-section-label">Ученик</div>
                    <button type="button" data-member-action="card">👤 Карточка ученика</button>
                </div>`;
            const head = row.querySelector('.group-action-member-head');
            const actions = row.querySelector('.group-member-actions');
            head.onclick = () => {
                const opening = actions.classList.contains('hidden');
                details.querySelectorAll('.group-member-actions').forEach(box => box.classList.add('hidden'));
                details.querySelectorAll('.group-action-member-head').forEach(button => button.setAttribute('aria-expanded', 'false'));
                if (opening) {
                    actions.classList.remove('hidden');
                    head.setAttribute('aria-expanded', 'true');
                }
            };
            row.querySelector('[data-member-action="card"]').onclick = () => { closeActionMenu(); openStudentCard(member.student_id); };
            row.querySelector('[data-member-action="subscription"]').onclick = () => openSubscriptionForStudent(lesson, member.student_id);
            row.querySelector('[data-member-action="free"]').onclick = () => setFreeStateForSelected(member.student_id, !member.free);
            row.querySelector('[data-member-action="student-chat"]').onclick = () => openStudentContactFor(member.student_id);
            row.querySelector('[data-member-action="parent-chat"]').onclick = () => openParentContactFor(member.student_id);
            row.querySelector('[data-member-action="paid"]').onclick = () => setGroupMemberPaidState(state.selectedLesson, member, !member.paid);
            if (cancelled) row.querySelectorAll('.group-member-actions button').forEach(button => { button.disabled = true; });
            details.appendChild(row);
        });
    }
    document.getElementById('action-menu-overlay').classList.remove('hidden');
}

async function setGroupMemberPaidState(lesson, member, makePaid) {
    if (!lesson || !member || member.free) return;
    if (hasAllocatedPayment(member)) return explainAllocatedPayment(member.student_id);
    if (member.paid_via_subscription) return alert('Занятие оплачено абонементом. Снятие оплаты одного занятия заблокировано.');
    const verb = makePaid ? 'Отметить оплату' : 'Снять оплату';
    if (!confirm(`${verb}: ${member.name || 'ученик'}?`)) return;
    const response = await apiFetch('/mark_paid', {
        method: 'POST',
        body: JSON.stringify({
            date: lesson.date,
            id: lesson.id,
            paid: makePaid,
            send_receipt: makePaid && state.settings.default_send_receipts !== false,
            student_id: member.student_id
        })
    });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка изменения оплаты');
    closeActionMenu();
    await refreshScheduleOnly();
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
    document.getElementById('lesson-repeat').value = 'year';
    document.getElementById('lesson-price').value = '';
    const dateValue = document.getElementById('lesson-date')?.value || dateKey(new Date());
    const repeatUntil = document.getElementById('repeat-until');
    repeatUntil.min = dateValue;
    repeatUntil.max = dateKey(new Date(`${dateValue}T12:00:00`).getTime() + 370 * 24 * 60 * 60 * 1000);
    repeatUntil.value = schoolYearEndFor(dateValue);
    document.getElementById('repeat-until-wrap').classList.remove('hidden');
    document.getElementById('reminder-enabled').checked = state.settings.default_reminders_enabled !== false;
    document.getElementById('reminder-minutes').value = '60';
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
    document.getElementById('lesson-date').value = date;
    resetAddForm();
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
    document.getElementById('lesson-price').value = lesson.price ?? '';
    document.getElementById('reminder-enabled').checked = lesson.reminder_enabled !== false;
    document.getElementById('reminder-minutes').value = lesson.reminder_minutes ?? 60;

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

    const repeat = state.editingExisting ? 'no' : document.getElementById('lesson-repeat').value;
    const repeatUntil = document.getElementById('repeat-until').value;
    if (!state.editingExisting && repeat === 'year') {
        if (!repeatUntil) return alert('Укажите дату окончания повторов');
        if (repeatUntil < date) return alert('Дата окончания повторов не может быть раньше первого занятия');
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 1440) {
        return alert('Длительность занятия должна быть от 15 до 1440 минут');
    }

    const priceValue = document.getElementById('lesson-price').value;
    const price = priceValue === '' ? 0 : Number(priceValue);
    if (lessonType === 'student' && (!Number.isFinite(price) || price < 0)) {
        return alert('Стоимость занятия должна быть неотрицательным числом');
    }
    const reminderMinutes = Number(document.getElementById('reminder-minutes').value || 60);
    if (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 10080) {
        return alert('Напоминание должно быть в диапазоне от 0 до 10080 минут');
    }

    const payload = {
        date, time, duration, lesson_type: lessonType,
        student, student_id: studentId,
        group_name: groupName, group_members: groupMembers,
        price: lessonType === 'student' ? price : '',
        reminder_enabled: document.getElementById('reminder-enabled').checked,
        reminder_minutes: reminderMinutes,
        repeat,
        repeat_until: repeatUntil
    };
    const endpoint = state.editingExisting ? '/update_lesson' : '/add_lesson';
    if (state.editingExisting) payload.id = state.selectedLesson.id;

    const saveButton = document.getElementById('btn-save');
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    try {
        const response = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения');
        closeAllModals();
        await refreshScheduleAndStudents();
    } catch (error) {
        alert(error?.message || 'Не удалось сохранить занятие');
    } finally {
        saveButton.disabled = false;
    }
}

function closeAllModals() {
    ['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'date-picker-overlay', 'app-settings-overlay', 'receipt-settings-overlay', 'student-card-overlay', 'work-center-overlay', 'paid-confirm-overlay', 'subscription-pay-overlay', 'lesson-report-overlay', 'students-overlay', 'student-payment-overlay'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
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

// Микроотчёт по проведённому занятию
function openLessonReport() {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const title = lesson.lesson_type === 'group' ? (lesson.group_name || lesson.student || 'Группа') : (lesson.student || 'Ученик');
    document.getElementById('lesson-report-title').textContent = `Итог · ${title} · ${lesson.time || ''}`;
    document.getElementById('lesson-report-text').value = lesson.report || '';
    document.getElementById('lesson-report-overlay').classList.remove('hidden');
}

document.getElementById('btn-close-lesson-report').onclick = () => document.getElementById('lesson-report-overlay').classList.add('hidden');
document.getElementById('btn-cancel-lesson-report').onclick = () => document.getElementById('lesson-report-overlay').classList.add('hidden');
document.getElementById('btn-save-lesson-report').onclick = async () => {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const button = document.getElementById('btn-save-lesson-report');
    button.disabled = true;
    try {
        const report = document.getElementById('lesson-report-text').value.trim();
        const response = await apiFetch('/update_lesson_report', {
            method: 'POST',
            body: JSON.stringify({ date: lesson.date, id: lesson.id, report })
        });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения итога');
        state.selectedLesson.report = report;
        document.getElementById('lesson-report-overlay').classList.add('hidden');
        await refreshScheduleOnly();
    } catch (error) {
        alert(error.message || 'Ошибка сохранения итога');
    } finally {
        button.disabled = false;
    }
};

function openStudentContactFor(studentId) {
    const info = getStudentInfo(studentId);
    if (info.username) return tg.openTelegramLink(`https://t.me/${info.username}`);
    const entries = Object.entries(info.student_contacts || {}).filter(([, value]) => value);
    if (entries.length === 1) return openContact(entries[0][0], entries[0][1]);
    if (entries.length > 1) {
        const choice = prompt('Выберите контакт ученика:\n' + entries.map(([type, value], i) => `${i + 1}. ${type.toUpperCase()}: ${value}`).join('\n') + '\n\nВведите номер:');
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < entries.length) return openContact(entries[idx][0], entries[idx][1]);
    }
    if (studentId && !String(studentId).startsWith('manual')) return tg.openTelegramLink(`tg://user?id=${studentId}`);
    alert('Контакт ученика не указан.');
}

function openParentContactFor(studentId) {
    const info = getStudentInfo(studentId);
    const entries = Object.entries(info.contacts || {}).filter(([, value]) => value);
    if (entries.length === 1) return openContact(entries[0][0], entries[0][1]);
    if (entries.length > 1) {
        const choice = prompt('Выберите контакт родителя:\n' + entries.map(([type, value], i) => `${i + 1}. ${type.toUpperCase()}: ${value}`).join('\n') + '\n\nВведите номер:');
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < entries.length) return openContact(entries[idx][0], entries[idx][1]);
    }
    alert('Контакт родителя не указан.');
}

async function setFreeStateForSelected(studentId = '', makeFree = true) {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const response = await apiFetch('/set_lesson_state', {
        method: 'POST',
        body: JSON.stringify({ date: lesson.date, id: lesson.id, action: makeFree ? 'free' : 'unfree', student_id: studentId })
    });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка');
    closeActionMenu();
    await refreshScheduleOnly();
}

function openSubscriptionForStudent(lesson, studentId) {
    if (!lesson) return;
    const target = lesson.lesson_type === 'group'
        ? (lesson.group_members || []).find(m => String(m.student_id) === String(studentId)) : lesson;
    if (target && (target.paid || target.free || hasAllocatedPayment(target))) {
        return alert('Сначала отмените существующую оплату или бесплатный статус. Общая оплата отменяется в карточке ученика.');
    }
    let price = 0;
    let name = '';
    if (lesson.lesson_type === 'group') {
        const member = (lesson.group_members || []).find(m => String(m.student_id) === String(studentId));
        if (!member) return;
        price = lessonPriceValue(lesson, member);
        name = member.name || getStudentInfo(studentId).name || 'Ученик';
    } else {
        studentId = lesson.student_id;
        price = lessonPriceValue(lesson);
        name = getStudentInfo(studentId).calendar_name || lesson.student || getStudentInfo(studentId).name || 'Ученик';
    }
    if (!(price > 0)) {
        closeActionMenu();
        alert('Сначала укажите стоимость этого занятия.');
        return;
    }
    state.subscriptionStudentId = String(studentId || '');
    state.subscriptionPrice = price;
    document.getElementById('subscription-pay-title').textContent = `Абонемент · ${name}`;
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
}

// Меню действий
document.getElementById('btn-action-student-card').onclick = () => { closeActionMenu(); if (state.selectedLesson) openStudentCard(state.selectedLesson.student_id); };
document.getElementById('btn-action-report').onclick = () => { closeActionMenu(); openLessonReport(); };
document.getElementById('btn-action-settings').onclick = () => { closeActionMenu(); if (state.selectedLesson) openEditModal(state.selectedLesson.date, state.selectedLesson); };
document.getElementById('btn-action-move-trigger').onclick = () => { closeActionMenu(); if (state.selectedLesson) startMove(state.selectedLesson.date, state.selectedLesson); };
document.getElementById('btn-action-free').onclick = () => {
    const lesson = state.selectedLesson;
    if (!lesson || lesson.lesson_type === 'group') return;
    setFreeStateForSelected('', !lesson.free);
};
document.getElementById('btn-action-cancel-once').onclick = async () => {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const action = lesson.cancelled ? 'restore' : 'cancel';
    const response = await apiFetch('/set_lesson_state', { method: 'POST', body: JSON.stringify({ date: lesson.date, id: lesson.id, action }) });
    const result = await response.json();
    if (result.status !== 'ok') return alert(result.message || 'Ошибка');
    closeActionMenu();
    await refreshScheduleOnly();
};
document.getElementById('btn-action-paid').onclick = async () => {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    const isGroup = lesson.lesson_type === 'group';
    if (!isGroup && hasAllocatedPayment(lesson)) return explainAllocatedPayment(lesson.student_id);
    if (!isGroup && lesson.paid_via_subscription) return alert('Занятие оплачено абонементом. Снятие оплаты одного занятия заблокировано.');
    if (!isGroup && lesson.free) return alert('Сначала отмените бесплатный статус.');

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
        ? 'Отметьте учеников, которые оплатили. Сумма берётся из стоимости каждого участника в этом занятии.'
        : (() => { const price = Number(lessonPriceValue(lesson)); return `Подтвердить оплату${price > 0 ? ` на ${price.toLocaleString('ru-RU')} ₽` : ''}?`; })();
    const membersBox = document.getElementById('group-paid-members');
    membersBox.innerHTML = '';
    membersBox.classList.toggle('hidden', !isGroup);
    if (isGroup) {
        (lesson.group_members || []).forEach(member => {
            const label = document.createElement('label');
            label.className = 'group-paid-member-row';
            const memberPrice = lessonPriceValue(lesson, member);
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
    if (!lesson) return;
    openSubscriptionForStudent(lesson, lesson.student_id);
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
    const price = Number(state.subscriptionPrice || lessonPriceValue(lesson));
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
    const price = Number(state.subscriptionPrice || lessonPriceValue(lesson));
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
            body: JSON.stringify({ date: lesson.date, id: lesson.id, student_id: state.subscriptionStudentId, amount, lesson_count: lessonCount, send_receipt: sendReceipt })
        });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка оплаты абонемента');
        document.getElementById('subscription-pay-overlay').classList.add('hidden');
        await Promise.all([refreshScheduleOnly(), refreshStudentsOnly()]);
        await refreshOpenPaymentCard();
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
    const lesson = state.selectedLesson;
    if (!lesson) return;
    if (lesson.lesson_type === 'group') {
        const members = lesson.group_members || [];
        if (!members.length) return alert('В группе нет учеников.');
        const choice = prompt('Кому написать?\n' + members.map((m, i) => `${i + 1}. ${m.name || 'Ученик'}`).join('\n') + '\n\nВведите номер:');
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < members.length) openStudentContactFor(members[idx].student_id);
    } else {
        openStudentContactFor(lesson.student_id);
    }
    closeActionMenu();
};

// Написать родителю (выбор мессенджера)
document.getElementById('btn-action-chat-parent').onclick = () => {
    const lesson = state.selectedLesson;
    if (!lesson) return;
    if (lesson.lesson_type === 'group') {
        const members = lesson.group_members || [];
        if (!members.length) return alert('В группе нет учеников.');
        const choice = prompt('Родителю какого ученика написать?\n' + members.map((m, i) => `${i + 1}. ${m.name || 'Ученик'}`).join('\n') + '\n\nВведите номер:');
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < members.length) openParentContactFor(members[idx].student_id);
    } else {
        openParentContactFor(lesson.student_id);
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
['modal-overlay', 'move-modal-overlay', 'action-menu-overlay', 'delete-modal-overlay', 'date-picker-overlay', 'app-settings-overlay', 'receipt-settings-overlay', 'student-card-overlay', 'work-center-overlay', 'paid-confirm-overlay', 'subscription-pay-overlay', 'lesson-report-overlay', 'students-overlay', 'student-payment-overlay'].forEach(id => {
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
        // Во время анимации сохраняем геометрию старой недели; автоподбор запускаем после слайда.
        autoFitWeekPending = false;
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
            autoFitWeekPending = true;
            scheduleCalendarAutoFit();
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
            autoFitWeekPending = true;
            document.getElementById('date-picker-overlay').classList.add('hidden');
            refreshScheduleOnly();
        };
        grid.appendChild(button);
    }
}

document.getElementById('month-label').onclick = () => {
    document.getElementById('app-settings-overlay').classList.add('hidden');
    openDatePicker();
};
document.getElementById('date-picker-prev').onclick = () => { state.datePickerMonth.setMonth(state.datePickerMonth.getMonth() - 1); renderDatePicker(); };
document.getElementById('date-picker-next').onclick = () => { state.datePickerMonth.setMonth(state.datePickerMonth.getMonth() + 1); renderDatePicker(); };
document.getElementById('date-picker-today').onclick = () => {
    const today = new Date();
    state.currentMonday = getMonday(today);
    autoFitWeekPending = true;
    document.getElementById('date-picker-overlay').classList.add('hidden');
    refreshScheduleOnly();
};
document.getElementById('date-picker-close').onclick = () => document.getElementById('date-picker-overlay').classList.add('hidden');

document.getElementById('btn-today').onclick = () => { state.currentMonday = getMonday(new Date()); autoFitWeekPending = true; refreshScheduleOnly(); };
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
    document.getElementById('default-zoom-link').value = state.settings.zoom_link || '';
    document.getElementById('work-start').value = state.settings.work_start || '10:00';
    document.getElementById('work-end').value = state.settings.work_end || '21:00';
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
            zoom_link: normalizeExternalUrl(document.getElementById('default-zoom-link').value),
            work_start: document.getElementById('work-start').value || '10:00',
            work_end: document.getElementById('work-end').value || '21:00',
            default_send_receipts: document.getElementById('default-send-receipts').checked,
            default_send_receipt_copy: document.getElementById('default-send-receipt-copy').checked
        };
        const response = await apiFetch('/update_settings', { method: 'POST', body: JSON.stringify(settings) });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка сохранения настроек');
        state.settings = result.settings || { ...state.settings, ...settings };
        updateVisibleHoursFromSettingsAndLessons();
        renderCalendar();
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
                const report = String(item.report || '').trim();
                return `<div class="student-history-row student-history-row-report"><div class="student-history-main"><span>${escapeHtml(dateLabel)} · ${escapeHtml(item.time || '')}</span><span class="student-history-paid ${item.paid ? 'is-paid' : ''}">${paidLabel}</span></div>${report ? `<div class="student-history-report">${escapeHtml(report)}</div>` : ''}</div>`;
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

function hasAllocatedPayment(target) {
    return Number(target.paid_amount || 0) > 0 || (target.allocation_ids || []).length > 0;
}

function paymentStatusLabel(target) {
    if (target.free) return 'Бесплатно';
    if (hasAllocatedPayment(target)) return target.paid ? 'Оплачено общей суммой' : 'Частично общей суммой';
    if (target.paid_via_subscription) return 'Абонемент';
    return target.paid ? 'Оплачено' : 'Не оплачено';
}

function paymentActionLabel(target) {
    if (hasAllocatedPayment(target)) return 'Оплачено общей суммой';
    if (target.paid_via_subscription) return '🎟 Оплачено абонементом';
    return target.paid && !target.free ? '↩ Снять оплату' : '💳 Оплачено';
}

function explainAllocatedPayment(studentId) {
    alert('На занятие распределена общая сумма, возможно частично. Полностью отменить платёж можно в истории общих оплат карточки ученика. Старые распределения без истории автоматически не отменяются.');
    closeActionMenu();
    openStudentCard(studentId);
    document.getElementById('student-finances').open = true;
    document.querySelector('.student-payment-history').open = true;
}

async function refreshOpenPaymentCard() {
    const card = document.getElementById('student-card-overlay');
    if (!card.classList.contains('hidden') && card.dataset.studentId) {
        await Promise.all([loadStudentPayments(card.dataset.studentId), loadStudentLessonStats(card.dataset.studentId)]);
    }
}

let studentPaymentsRequest = 0;
async function loadStudentPayments(studentId) {
    const requestId = ++studentPaymentsRequest;
    const list = document.getElementById('student-payment-lessons');
    const transactions = document.getElementById('student-payment-transactions');
    list.textContent = 'Загрузка оплат…';
    transactions.textContent = '';
    try {
        const response = await apiFetch('/get_student_payments', { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
        const result = await response.json();
        if (requestId !== studentPaymentsRequest || document.getElementById('student-card-overlay').dataset.studentId !== String(studentId)) return;
        if (result.status !== 'ok') throw new Error(result.message || 'Не удалось загрузить оплаты');
        const lessons = result.lessons || [];
        list.innerHTML = '';
        if (!lessons.length) list.textContent = 'Занятий пока нет.';
        lessons.forEach(item => {
            const row = document.createElement('article');
            row.className = 'student-finance-row';
            const price = item.price == null ? 'Цена не указана' : money(item.price);
            const allocated = hasAllocatedPayment(item);
            const actions = item.source === 'unpaid'
                ? '<button type="button" data-finance-action="direct">💳 Оплачено</button><button type="button" data-finance-action="subscription">🎟 Абонемент</button><button type="button" data-finance-action="free">🎁 Бесплатно</button>'
                : item.source === 'direct' ? '<button type="button" data-finance-action="reverse">↩ Снять оплату</button>'
                : item.source === 'free' ? '<button type="button" data-finance-action="unfree">↩ Отменить бесплатно</button>' : '';
            let note = '';
            if (allocated) {
                note = (item.allocation_ids || []).length
                    ? 'Отмена всего платежа — в истории общих оплат ниже. Если платежи пересекаются, сначала отмените более поздний.'
                    : 'Старое распределение без истории: автоматическая отмена недоступна.';
            } else if (item.source === 'subscription') {
                note = 'Оплачено абонементом. Снятие оплаты одного занятия заблокировано, чтобы сохранить учёт абонемента.';
            }
            row.innerHTML = `<strong>${escapeHtml(item.date)} · ${escapeHtml(item.time || '')}</strong>
                <div>${escapeHtml(item.lesson_type === 'group' ? `Группа · ${item.group_name}` : 'Индивидуальное')} · ${escapeHtml(price)}</div>
                <div class="student-finance-status">${escapeHtml(paymentStatusLabel(item))}${allocated ? ` · ${escapeHtml(money(item.paid_amount))} из ${escapeHtml(price)}` : ''}${item.cancelled ? ' · Занятие отменено' : ''}</div>
                ${note ? `<p class="field-hint">${escapeHtml(note)}</p>` : ''}
                <div class="student-finance-actions">${item.cancelled && item.source === 'unpaid' ? '' : actions}</div>`;
            row.querySelectorAll('[data-finance-action]').forEach(button => {
                button.onclick = () => changeStudentLessonPayment(studentId, item, button.dataset.financeAction, row);
            });
            list.appendChild(row);
        });
        transactions.innerHTML = '';
        if (!(result.transactions || []).length) transactions.textContent = 'Сохранённых общих оплат пока нет.';
        (result.transactions || []).forEach(tx => {
            const row = document.createElement('article');
            row.className = 'student-finance-row';
            const allocations = (tx.allocations || []).map(a => `<li>${escapeHtml(a.date)} · ${escapeHtml(a.time || '')} · ${a.is_group ? 'Групповое' : 'Индивидуальное'} · ${escapeHtml(money(a.amount))}</li>`).join('');
            row.innerHTML = `<strong>${escapeHtml(money(tx.amount))} · ${tx.reversed_at ? 'Отменена' : 'Общая оплата'}</strong>
                <div>${escapeHtml(new Date(tx.created_at).toLocaleString('ru-RU'))} · № ${escapeHtml(tx.receipt_number || '')}</div>
                <ul>${allocations}</ul>
                ${tx.reversed_at ? `<small>Отменена ${escapeHtml(new Date(tx.reversed_at).toLocaleString('ru-RU'))}</small>` : '<button type="button" class="secondary-btn">↩ Отменить весь платёж</button>'}`;
            const button = row.querySelector('button');
            if (button) button.onclick = async () => {
                if (!confirm(`Отменить всю общую оплату ${money(tx.amount)}? Будут восстановлены ${tx.allocations.length} занятий и добавлена отрицательная запись в книгу.`)) return;
                button.disabled = true;
                try {
                    const response = await apiFetch('/reverse_student_payment', { method: 'POST', body: JSON.stringify({ student_id: studentId, transaction_id: tx.id }) });
                    const result = await response.json();
                    if (result.status !== 'ok') throw new Error(result.message || 'Не удалось отменить оплату');
                    await Promise.all([refreshScheduleOnly(), refreshOpenPaymentCard()]);
                } catch (error) {
                    alert(error.message || 'Ошибка отмены оплаты');
                } finally {
                    button.disabled = false;
                }
            };
            transactions.appendChild(row);
        });
    } catch (error) {
        if (requestId === studentPaymentsRequest) list.textContent = error.message || 'Не удалось загрузить оплаты.';
    }
}

async function changeStudentLessonPayment(studentId, item, action, row) {
    if (action === 'subscription') {
        const lesson = { ...item };
        if (item.lesson_type === 'group') lesson.group_members = [{ ...item, name: item.student }];
        state.selectedLesson = lesson;
        openSubscriptionForStudent(lesson, studentId);
        return;
    }
    const descriptions = { direct: 'Отметить занятие оплаченным', reverse: 'Снять оплату', free: 'Сделать занятие бесплатным', unfree: 'Отменить бесплатный статус' };
    if (!confirm(`${descriptions[action]}: ${item.date} ${item.time || ''}?`)) return;
    row.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
        const isState = action === 'free' || action === 'unfree';
        const response = await apiFetch(isState ? '/set_lesson_state' : '/mark_paid', {
            method: 'POST',
            body: JSON.stringify({ date: item.date, id: item.id, student_id: studentId,
                ...(isState ? { action } : { paid: action === 'direct', send_receipt: action === 'direct' && state.settings.default_send_receipts !== false }) })
        });
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || 'Не удалось изменить оплату');
        await Promise.all([refreshScheduleOnly(), refreshOpenPaymentCard()]);
    } catch (error) {
        alert(error.message || 'Ошибка изменения оплаты');
    } finally {
        row.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
}

function openStudentCard(studentId) {
    if (!studentId || !state.students[studentId]) return alert('Карточка доступна после сохранения ученика.');
    document.getElementById('student-finances').open = false;
    document.querySelector('.student-payment-history').open = false;
    document.querySelector('#student-card-overlay .modal-body').scrollTop = 0;
    const info = getStudentInfo(studentId);
    document.getElementById('student-card-overlay').dataset.studentId = studentId;
    document.getElementById('btn-archive-student').textContent = info.archived ? 'Вернуть ученика из архива' : 'Убрать ученика в архив';
    document.getElementById('student-card-title').textContent = info.name || 'Ученик';
    document.getElementById('student-calendar-name').value = info.calendar_name || '';
    document.getElementById('student-birthday').value = info.birthday || '';
    document.getElementById('student-note').value = info.note || '';
    document.getElementById('student-board-link').value = info.board_link || '';
    document.getElementById('student-zoom-link').value = info.zoom_link || '';
    setStudentStatus(info.status || 'active');
    renderContacts('student-card-student-contacts', info.student_contacts || {});
    renderContacts('student-card-parent-contacts', info.contacts || {});
    document.getElementById('student-card-overlay').classList.remove('hidden');
    loadStudentLessonStats(studentId);
    loadStudentPayments(studentId);
}

document.getElementById('btn-close-student-card').onclick = () => document.getElementById('student-card-overlay').classList.add('hidden');
document.getElementById('btn-cancel-student-card').onclick = () => document.getElementById('student-card-overlay').classList.add('hidden');
document.getElementById('btn-save-student-card').onclick = async () => {
    const studentId = document.getElementById('student-card-overlay').dataset.studentId;
    const payload = {
        student_id: studentId,
        calendar_name: document.getElementById('student-calendar-name').value.trim(),
        birthday: document.getElementById('student-birthday').value,
        status: document.getElementById('student-card-overlay').dataset.studentStatus || 'active',
        note: document.getElementById('student-note').value.trim(),
        board_link: normalizeExternalUrl(document.getElementById('student-board-link').value),
        zoom_link: normalizeExternalUrl(document.getElementById('student-zoom-link').value),
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

function normalizeExternalUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value}`;
}

function openExternalLink(url) {
    const value = normalizeExternalUrl(url);
    if (!value) return alert('Ссылка не указана');
    try { tg.openLink(value); } catch (e) { window.open(value, '_blank', 'noopener,noreferrer'); }
}

function isDesktopApp() {
    return ['tdesktop', 'macos', 'unigram'].includes(tg.platform) ||
        ((!tg.platform || tg.platform === 'unknown' || tg.platform.startsWith('web')) &&
         !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && navigator.maxTouchPoints < 2);
}

const fullscreenButton = document.getElementById('btn-fullscreen');
const telegramFullscreen = isDesktopApp() && typeof tg.requestFullscreen === 'function' &&
    typeof tg.exitFullscreen === 'function' && tg.isVersionAtLeast?.('8.0');
function updateFullscreenButton() {
    fullscreenButton.classList.toggle('hidden', !isDesktopApp() || !(telegramFullscreen || document.fullscreenEnabled));
    const active = telegramFullscreen ? tg.isFullscreen : !!document.fullscreenElement;
    fullscreenButton.title = active ? 'Выйти из полного экрана' : 'На весь экран';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    fullscreenButton.setAttribute('aria-pressed', String(!!active));
}
fullscreenButton.onclick = async () => {
    try {
        if (telegramFullscreen) {
            if (tg.isFullscreen) tg.exitFullscreen(); else tg.requestFullscreen();
        } else if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
    } catch (error) { alert('Этот клиент не разрешил полный экран.'); }
    updateFullscreenButton();
};
document.addEventListener('fullscreenchange', updateFullscreenButton);
tg.onEvent?.('fullscreenChanged', updateFullscreenButton);
tg.onEvent?.('fullscreenFailed', () => alert('Полный экран недоступен в этом клиенте Telegram.'));
updateFullscreenButton();

function lessonStartsAt(item) {
    return new Date(item.starts_at || `${item.date}T${item.time}:00`).getTime();
}
function quickMessageRecipients(item) {
    const members = item.lesson_type === 'group' ? (item.group_members || []) :
        [{ student_id: item.student_id, name: item.student }];
    return members.flatMap(member => {
        const info = getStudentInfo(member.student_id) || {};
        return [['Ученик', info.student_contacts], ['Родитель', info.contacts]].flatMap(([role, contacts]) => {
            const value = String(contacts?.tg || '').trim();
            // Numeric Telegram IDs cannot address a username draft.
            const username = value.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/\/$/, '');
            if (!/^[a-z][a-z0-9_]{3,31}$/i.test(username)) return [];
            return [{ name: member.name || info.name || 'Ученик', label: `${member.name || info.name || 'Ученик'} · ${role}`, username }];
        });
    });
}
function showQuickMessage(item) {
    const overlay = document.getElementById('quick-message-overlay');
    const choices = document.getElementById('quick-message-choices');
    const hint = document.getElementById('quick-message-hint');
    document.getElementById('quick-message-title').textContent = 'Ученик опаздывает';
    hint.textContent = 'Откроется Telegram с текстом. Отправку нужно нажать в чате.';
    document.getElementById('quick-message-text').classList.add('hidden');
    document.getElementById('btn-copy-quick-message').classList.add('hidden');
    choices.replaceChildren();
    overlay.classList.remove('hidden');
    const recipients = quickMessageRecipients(item);
    const chooseRecipient = () => {
        choices.replaceChildren();
        if (!recipients.length) {
            hint.textContent = 'Добавьте Telegram @username ученика или родителя в карточке ученика.';
            return;
        }
        const open = recipient => {
            if (Date.now() < lessonStartsAt(item) || Date.now() - lessonStartsAt(item) >= 15 * 60000) {
                hint.textContent = 'Кнопка доступна только первые 15 минут занятия.';
                return;
            }
            const message = `Добрый день! ${recipient.name} сегодня будет на занятии?`;
            const draft = document.getElementById('quick-message-text');
            draft.value = message;
            draft.classList.remove('hidden');
            const copy = document.getElementById('btn-copy-quick-message');
            copy.classList.remove('hidden');
            copy.onclick = async () => {
                try { await navigator.clipboard.writeText(message); }
                catch (error) { draft.focus(); draft.select(); }
            };
            const link = `https://t.me/${recipient.username}?text=${encodeURIComponent(message)}`;
            try { tg.openTelegramLink(link); } catch (error) { window.open(link, '_blank', 'noopener,noreferrer'); }
        };
        recipients.forEach(recipient => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'secondary-btn';
            button.textContent = recipient.label;
            button.onclick = () => open(recipient);
            choices.appendChild(button);
        });
        if (recipients.length === 1) open(recipients[0]);
    };
    chooseRecipient();
}
document.getElementById('btn-close-quick-message').onclick =
document.getElementById('btn-cancel-quick-message').onclick = () =>
    document.getElementById('quick-message-overlay').classList.add('hidden');

function renderTopLesson() {
    const data = state.workCenter || {};
    const current = data.current_lesson || null;
    const next = data.next_lesson || null;
    const summary = document.getElementById('top-next-lesson-summary');
    const details = document.getElementById('top-next-lesson-details');
    if (!summary || !details) return;

    const nowMs = Date.now();
    let showNextBesideCurrent = false;
    if (current && next) {
        const end = new Date(current.ends_at || `${current.date}T${current.end_time || current.time}:00`);
        showNextBesideCurrent = !Number.isNaN(end.getTime()) && (end.getTime() - nowMs) <= 10 * 60 * 1000;
    }

    if (current) {
        summary.textContent = showNextBesideCurrent && next
            ? `● ${current.student} ${current.time || ''} › ${next.student} ${next.time || ''}`
            : `● ${current.student} ${current.time || ''}`;
    } else if (next) {
        summary.textContent = `Далее › ${next.student} ${next.time || ''}`;
    } else {
        summary.textContent = 'Ближайших занятий нет';
    }

    const items = [];
    if (current) items.push({ label: 'Сейчас', item: current });
    if (next && (!current || showNextBesideCurrent)) items.push({ label: 'Далее', item: next });
    details.innerHTML = items.map(({label, item}, i) => {
        const buttons = [
            item.board_link ? `<button type="button" class="next-link-btn" data-top-link="${i}-board">Доска</button>` : '',
            isDesktopApp() ? `<button type="button" class="next-link-btn" data-top-link="${i}-zoom">Zoom</button>` : '',
            quickMessageRecipients(item).length ? `<button type="button" class="next-link-btn" data-top-late="${i}" data-start="${lessonStartsAt(item)}" aria-label="Ученик опаздывает">⏱</button>` : ''
        ].filter(Boolean).join('');
        return `<div class="top-next-detail-row"><div><small>${label}</small><strong>${escapeHtml(item.student || 'Ученик')} · ${escapeHtml(item.time || '')}</strong></div>${buttons ? `<div class="next-lesson-actions">${buttons}</div>` : ''}</div>`;
    }).join('') || '<div class="hub-empty">Ближайших занятий нет.</div>';
    items.forEach(({item}, i) => {
        details.querySelector(`[data-top-link="${i}-board"]`)?.addEventListener('click', e => { e.stopPropagation(); openExternalLink(item.board_link); });
        details.querySelector(`[data-top-link="${i}-zoom"]`)?.addEventListener('click', e => { e.stopPropagation(); openExternalLink(new URL('zoom-launch.html?v=30.8.7', window.location.href).href); });
        details.querySelector(`[data-top-late="${i}"]`)?.addEventListener('click', () => showQuickMessage(item));
    });
    updateLateButtons();
}

function updateLateButtons() {
    document.querySelectorAll('[data-top-late]').forEach(button => {
        const elapsed = Date.now() - Number(button.dataset.start);
        button.classList.toggle('hidden', !(elapsed >= 0 && elapsed < 15 * 60000));
    });
}
setInterval(updateLateButtons, 1000);
setInterval(() => { if (!document.hidden) refreshWorkCenterBadge(); }, 60000);

function renderWorkCenter() {
    const data = state.workCenter || { debts: [], windows: [], birthdays: [], summary: {} };
    renderTopLesson();
    const debts = Array.isArray(data.debts) ? data.debts : [];
    const debtAlert = document.getElementById('work-center-debt-alert');
    if (debtAlert) {
        debtAlert.classList.toggle('hidden', debts.length === 0);
        debtAlert.setAttribute('aria-hidden', debts.length === 0 ? 'true' : 'false');
    }
    document.getElementById('hub-debts-count').textContent = debts.length;
    document.getElementById('hub-debts').innerHTML = debts.length
        ? `<div class="hub-debt-total"><span>Всего к оплате</span><strong>${money(data.debt_total || 0)}</strong></div>` + debts.map(item => `<div class="hub-item"><strong>${escapeHtml(item.name || 'Ученик')}</strong><span>${item.unpaid_count || 0} зан. · ${money(item.amount || 0)}</span></div>`).join('')
        : '<div class="hub-empty">Просроченных неоплаченных занятий нет.</div>';

    document.getElementById('hub-windows').innerHTML = (data.windows || []).length
        ? data.windows.map(item => `<div class="hub-item"><strong>${shortDateRu(item.date)}</strong><span>${item.from}–${item.to}</span></div>`).join('')
        : '<div class="hub-empty">Свободных окон от 60 минут нет.</div>';

    const summaryData = data.summary || {};
    document.getElementById('hub-summary').innerHTML = `
        <div class="summary-grid">
            <div><small>Занятий</small><strong>${summaryData.lessons || 0}</strong></div>
            <div><small>Оплачено</small><strong>${summaryData.paid || 0}</strong></div>
            <div><small>План</small><strong>${money(summaryData.planned_sum)}</strong></div>
            <div><small>Получено</small><strong>${money(summaryData.paid_sum)}</strong></div>
        </div>`;

    document.getElementById('hub-birthdays').innerHTML = (data.birthdays || []).length
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
        const cardHeight = Math.max(18, duration * hourHeight / 60 - 2);
        card.style.top = `${startMinutes * hourHeight / 60}px`;
        card.style.height = `${cardHeight}px`;
        card.classList.remove('event-card-compact', 'event-card-medium', 'event-card-tall');
        if (cardHeight < 34) card.classList.add('event-card-compact');
        else if (cardHeight < 54) card.classList.add('event-card-medium');
        else card.classList.add('event-card-tall');
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

// v30.7: единый раздел учеников и оплата произвольной суммой
function renderStudentsList(filter = '') {
    const box = document.getElementById('students-list');
    if (!box) return;
    const q = String(filter || '').trim().toLocaleLowerCase('ru');
    const rows = visibleStudentEntries().filter(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
        return !!info.archived === document.getElementById('students-show-archived').checked
            && (!q || String(info.name || id).toLocaleLowerCase('ru').includes(q));
    });
    box.innerHTML = '';
    if (!rows.length) {
        box.innerHTML = '<div class="hub-empty">Ученики не найдены.</div>';
        return;
    }
    rows.forEach(([id, raw]) => {
        const info = typeof raw === 'string' ? { name: raw } : (raw || {});
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'student-list-row';
        btn.innerHTML = `<strong>${escapeHtml(info.name || id)}</strong><span>›</span>`;
        btn.onclick = () => {
            document.getElementById('students-overlay').classList.add('hidden');
            openStudentCard(id);
        };
        box.appendChild(btn);
    });
}

document.getElementById('btn-students').onclick = () => {
    document.getElementById('students-show-archived').checked = false;
    document.getElementById('students-search').value = '';
    renderStudentsList('');
    document.getElementById('students-overlay').classList.remove('hidden');
};
document.getElementById('students-search').addEventListener('input', e => renderStudentsList(e.target.value));
document.getElementById('students-show-archived').onchange = () => renderStudentsList(document.getElementById('students-search').value);
document.getElementById('btn-archive-student').onclick = async () => {
    const studentId = document.getElementById('student-card-overlay').dataset.studentId;
    const archived = !getStudentInfo(studentId).archived;
    if (!confirm(archived ? 'Убрать ученика из общего списка? История, оплаты и уже созданные занятия сохранятся. Ученика можно вернуть из архива.' : 'Вернуть ученика в общий список?')) return;
    const button = document.getElementById('btn-archive-student');
    button.disabled = true;
    try {
        const response = await apiFetch('/set_student_archived', { method: 'POST', body: JSON.stringify({ student_id: studentId, archived }) });
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || 'Не удалось изменить архив');
        state.students[studentId] = result.student;
        fillStudentsDropdown();
        document.getElementById('student-card-overlay').classList.add('hidden');
        document.getElementById('btn-students').click();
    } catch (error) {
        alert(error.message || 'Не удалось изменить архив');
    } finally { button.disabled = false; }
};
document.getElementById('btn-close-students').onclick = () => document.getElementById('students-overlay').classList.add('hidden');
document.getElementById('btn-close-students-bottom').onclick = () => document.getElementById('students-overlay').classList.add('hidden');

let selectedPaymentQuote = null;
let paymentOptionsRequest = 0;
document.getElementById('btn-student-payment').onclick = async () => {
    const studentId = document.getElementById('student-card-overlay').dataset.studentId;
    if (!studentId) return;
    const info = getStudentInfo(studentId);
    document.getElementById('student-payment-overlay').dataset.studentId = studentId;
    document.getElementById('student-payment-title').textContent = `Оплата · ${info.name || 'Ученик'}`;
    document.getElementById('student-payment-amount').value = '';
    document.getElementById('student-payment-send-receipt').checked = state.settings.default_send_receipts !== false;
    document.getElementById('student-payment-overlay').classList.remove('hidden');
    selectedPaymentQuote = null;
    const requestId = ++paymentOptionsRequest;
    const options = document.getElementById('student-payment-options');
    const explanation = document.getElementById('student-payment-explanation');
    const amountInput = document.getElementById('student-payment-amount');
    const applyButton = document.getElementById('btn-apply-student-payment');
    amountInput.closest('.form-group').classList.add('hidden');
    applyButton.classList.add('hidden');
    options.textContent = 'Рассчитываем варианты…';
    explanation.textContent = 'Варианты оплачивают ближайшие будущие занятия с указанной ценой. Прошлые долги не включены.';
    try {
        const response = await apiFetch('/get_student_payment_options', { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
        const result = await response.json();
        if (requestId !== paymentOptionsRequest) return;
        if (result.status !== 'ok') throw new Error(result.message);
        options.innerHTML = '';
        (result.options || []).forEach(quote => {
            const block = document.createElement('div');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'primary-btn';
            button.textContent = `${quote.count} ${quote.count === 4 ? 'занятия' : 'занятий'} — ${money(quote.amount)}`;
            button.onclick = () => {
                if (applyButton.disabled) return;
                selectedPaymentQuote = quote;
                amountInput.value = String(quote.amount);
                document.getElementById('btn-apply-student-payment').click();
            };
            const details = document.createElement('details');
            details.innerHTML = '<summary>Какие занятия</summary><ul>' + (quote.lessons || []).map(lesson =>
                `<li>${escapeHtml(lesson.date)} · ${escapeHtml(lesson.time)} · ${lesson.is_group ? 'Группа' : 'Индивидуальное'} · ${escapeHtml(money(lesson.amount))}</li>`).join('') + '</ul>';
            block.append(button, details);
            options.appendChild(block);
        });
        if (!(result.options || []).length) explanation.textContent = 'Пока нет четырёх будущих неоплаченных занятий с указанной ценой. Можно внести другую сумму.';
    } catch (error) {
        if (requestId !== paymentOptionsRequest) return;
        options.innerHTML = '';
        explanation.textContent = 'Варианты сейчас недоступны. Можно внести другую сумму.';
    }
    const custom = document.createElement('button');
    custom.type = 'button';
    custom.className = 'secondary-btn';
    custom.textContent = 'Другая сумма';
    custom.onclick = () => {
        selectedPaymentQuote = null;
        amountInput.value = '';
        amountInput.closest('.form-group').classList.remove('hidden');
        applyButton.classList.remove('hidden');
        explanation.textContent = 'Сумма распределится начиная с самых старых неоплаченных занятий, включая долги.';
        amountInput.focus();
    };
    options.appendChild(custom);
};
document.getElementById('btn-close-student-payment').onclick =
document.getElementById('btn-cancel-student-payment').onclick = () => document.getElementById('student-payment-overlay').classList.add('hidden');
document.getElementById('btn-apply-student-payment').onclick = async () => {
    const overlay = document.getElementById('student-payment-overlay');
    const studentId = overlay.dataset.studentId;
    const amount = Number(document.getElementById('student-payment-amount').value || 0);
    if (!(amount > 0)) return alert('Укажите сумму оплаты.');
    const button = document.getElementById('btn-apply-student-payment');
    if (button.disabled) return;
    const quote = selectedPaymentQuote;
    button.disabled = true;
    document.querySelectorAll('#student-payment-options button').forEach(item => { item.disabled = true; });
    try {
        const response = await apiFetch('/apply_student_payment', {
            method: 'POST',
            body: JSON.stringify({
                student_id: studentId,
                amount,
                ...(quote ? { quick_count: quote.count, preview_token: quote.preview_token } : {}),
                send_receipt: document.getElementById('student-payment-send-receipt').checked
            })
        });
        const result = await response.json();
        if (result.status !== 'ok') return alert(result.message || 'Ошибка оплаты');
        overlay.classList.add('hidden');
        await Promise.all([refreshScheduleOnly(), loadStudentLessonStats(studentId)]);
        await loadStudentPayments(studentId);
        const restText = Number(result.unallocated || 0) > 0 ? ` Не распределено: ${money(result.unallocated)}.` : '';
        alert(`Оплата распределена.${restText} ${result.receipt_message || ''}`.trim());
    } catch (error) {
        alert('Не удалось получить результат оплаты. Перед повторной оплатой проверьте историю ученика.');
    } finally {
        button.disabled = false;
        document.querySelectorAll('#student-payment-options button').forEach(item => { item.disabled = false; });
    }
};

document.getElementById('lesson-repeat').addEventListener('change', e => {
    const year = e.target.value === 'year';
    document.getElementById('repeat-until-wrap').classList.toggle('hidden', !year);
    const repeatUntil = document.getElementById('repeat-until');
    const lessonDate = document.getElementById('lesson-date').value;
    if (year) {
        repeatUntil.min = lessonDate;
        repeatUntil.max = dateKey(new Date(`${lessonDate}T12:00:00`).getTime() + 370 * 24 * 60 * 60 * 1000);
        if (!repeatUntil.value) repeatUntil.value = schoolYearEndFor(lessonDate);
    }
});

document.getElementById('top-next-lesson').onclick = () => {
    document.getElementById('top-next-lesson-details').classList.toggle('hidden');
};
