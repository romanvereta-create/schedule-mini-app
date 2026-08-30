// ============================================================
// ИНИЦИАЛИЗАЦИЯ TELEGRAM
// ============================================================

const tg = window.Telegram.WebApp;
tg.expand(); // Растягиваем на весь экран

const user = tg.initDataUnsafe?.user || { id: 0, first_name: 'Гость' };

// Состояние приложения
const state = {
    selectedDay: 0,      // индекс дня (0 = ПН)
    weekOffset: 0,       // смещение недели (0 = текущая)
    schedule: {},        // данные расписания с сервера
    students: {},        // список учеников
    slots: [],           // слоты (временные интервалы)
    loading: false,
};

// DOM-элементы
const $ = (id) => document.getElementById(id);
const scheduleContainer = $('schedule-container');
const weekLabel = $('week-label');
const btnPrev = $('btn-prev-week');
const btnNext = $('btn-next-week');
const btnToday = $('btn-today');
const btnAdd = $('btn-add-lesson');
const btnSettings = $('btn-settings');
const modalOverlay = $('modal-overlay');
const modalBody = $('modal-body');
const modalClose = $('modal-close');

// ============================================================
// ЗАГРУЗКА ДАННЫХ ОТ БОТА
// ============================================================

function loadSchedule() {
    state.loading = true;
    tg.sendData(JSON.stringify({
        action: 'get_schedule',
        user_id: user.id,
        day_index: state.selectedDay,
        week_offset: state.weekOffset
    }));
}

function loadStudents() {
    tg.sendData(JSON.stringify({
        action: 'get_students',
        user_id: user.id
    }));
}

function loadSlots() {
    tg.sendData(JSON.stringify({
        action: 'get_slots',
        user_id: user.id
    }));
}

// Обработка данных от бота
tg.onEvent('mainButtonClicked', () => {});
tg.onEvent('backButtonClicked', () => {});

// ============================================================
// ОТРИСОВКА РАСПИСАНИЯ
// ============================================================

function renderSchedule(data) {
    if (!data || !data.slots) {
        scheduleContainer.innerHTML = `
            <div class="empty-state">
                <div class="big-icon">📅</div>
                <p>Нет данных</p>
                <p style="font-size:13px;margin-top:4px;">Нажмите «Добавить занятие»</p>
            </div>
        `;
        return;
    }

    const { slots, lessons } = data;
    const busyTimes = lessons.map(l => l.time);

    let html = '';
    let hasLessons = false;

    slots.forEach(slot => {
        const isBusy = busyTimes.includes(slot);
        const lesson = lessons.find(l => l.time === slot);

        const timeClass = 'slot-time';
        const studentClass = 'slot-student';
        const bellClass = 'slot-bell';
        const deleteClass = 'slot-delete';

        if (isBusy && lesson) {
            hasLessons = true;
            const student = lesson.student || 'Неизвестно';
            const reminder = lesson.reminder_minutes || 60;
            const bellIcon = reminder > 0 ? '🔔✅' : '🔕❌';

            html += `
                <div class="slot-row" data-action="edit_lesson" data-time="${slot}">
                    <span class="${timeClass}">${slot}</span>
                    <span class="${studentClass}">${student}</span>
                    <span class="${bellClass}" data-action="edit_reminder" data-time="${slot}">${bellIcon}</span>
                    <span class="${deleteClass}" data-action="delete_lesson" data-time="${slot}">🗑</span>
                </div>
            `;
        } else {
            html += `
                <div class="slot-row" data-action="add_slot" data-time="${slot}">
                    <span class="${timeClass}">${slot}</span>
                    <span class="slot-empty">➕</span>
                    <span class="${bellClass}"></span>
                    <span class="${deleteClass}"></span>
                </div>
            `;
        }
    });

    if (!hasLessons) {
        html += `
            <div class="empty-state">
                <div class="big-icon">📅</div>
                <p>Нет занятий на этот день</p>
                <p style="font-size:13px;margin-top:4px;">Нажмите «Добавить занятие»</p>
            </div>
        `;
    }

    scheduleContainer.innerHTML = html;
    updateWeekLabel();
    attachSlotEvents();
}

function updateWeekLabel() {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1 + state.weekOffset * 7);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const formatDate = (d) => `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth()+1).toString().padStart(2, '0')}`;
    weekLabel.textContent = `${formatDate(startOfWeek)} – ${formatDate(endOfWeek)}`;
}

// ============================================================
// ОБРАБОТКА СОБЫТИЙ ОТ БОТА
// ============================================================

// Перехватываем данные, которые бот отправляет в ответ
// (бот должен отправлять их через sendData)
// Для демонстрации используем глобальный обработчик
window.handleBotResponse = function(data) {
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        console.log('📥 Ответ от бота:', parsed);

        if (parsed.action === 'get_schedule') {
            renderSchedule(parsed);
        } else if (parsed.action === 'get_students') {
            state.students = parsed.students || {};
        } else if (parsed.action === 'get_slots') {
            state.slots = parsed.slots || [];
        } else if (parsed.action === 'add_lesson' || parsed.action === 'delete_lesson' || parsed.action === 'edit_time') {
            // После любого изменения перезагружаем расписание
            loadSchedule();
        }
    } catch (e) {
        console.error('Ошибка обработки ответа:', e);
    }
};

// ============================================================
// ОБРАБОТКА КЛИКОВ ПО СЛОТАМ
// ============================================================

function attachSlotEvents() {
    document.querySelectorAll('.slot-row').forEach(row => {
        row.addEventListener('click', function(e) {
            const action = this.dataset.action;
            const time = this.dataset.time;

            // Если клик по вложенной кнопке (колокольчик или удаление)
            if (e.target.dataset.action) {
                const targetAction = e.target.dataset.action;
                const targetTime = e.target.dataset.time || time;

                if (targetAction === 'edit_reminder') {
                    openReminderModal(targetTime);
                } else if (targetAction === 'delete_lesson') {
                    confirmDeleteLesson(targetTime);
                }
                return;
            }

            if (action === 'add_slot') {
                openAddLessonModal(time);
            } else if (action === 'edit_lesson') {
                // Показываем выбор времени
                openTimePicker(time);
            }
        });
    });
}

// ============================================================
// МОДАЛЬНЫЕ ОКНА
// ============================================================

function openModal(html) {
    modalBody.innerHTML = html;
    modalOverlay.style.display = 'flex';
}

function closeModal() {
    modalOverlay.style.display = 'none';
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
});

// ============================================================
// ДОБАВЛЕНИЕ ЗАНЯТИЯ
// ============================================================

function openAddLessonModal(slotTime) {
    const studentsHtml = Object.entries(state.students)
        .map(([id, name]) => `<button class="student-chip" data-id="${id}" data-name="${name}">${name}</button>`)
        .join('');

    const html = `
        <h2 style="margin-bottom:16px;">➕ Добавить занятие</h2>
        <div class="form-group">
            <label>Ученик</label>
            <div class="student-list" id="student-list">
                ${studentsHtml || '<p style="font-size:13px;color:#999;">Нет учеников. Добавьте их через бота.</p>'}
            </div>
            <input type="text" id="manual-student" placeholder="Или введите имя вручную" style="margin-top:8px;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
        </div>
        <div class="form-group">
            <label>Дата</label>
            <input type="date" id="lesson-date" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-group">
            <label>Время</label>
            <input type="time" id="lesson-time" value="${slotTime || '10:00'}" step="300">
        </div>
        <div class="form-group">
            <label>Повтор</label>
            <div class="repeat-options">
                <button class="repeat-btn selected" data-value="no">Только день</button>
                <button class="repeat-btn" data-value="month">На месяц</button>
                <button class="repeat-btn" data-value="year">До 31 мая</button>
            </div>
        </div>
        <div class="form-group">
            <label>Напоминание (минут)</label>
            <div class="reminder-options">
                <button class="reminder-btn" data-value="5">5</button>
                <button class="reminder-btn" data-value="15">15</button>
                <button class="reminder-btn selected" data-value="60">60</button>
                <button class="reminder-btn" data-value="120">120</button>
                <button class="reminder-btn" data-value="0">Выкл</button>
            </div>
        </div>
        <div class="form-group">
            <label>Ссылка на конференцию (опционально)</label>
            <input type="url" id="lesson-zoom" placeholder="https://zoom.us/j/123456789" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
        </div>
        <button id="submit-lesson" class="submit-btn">✅ Добавить</button>
        <button id="cancel-lesson" class="submit-btn cancel-btn" style="margin-top:8px;">❌ Отмена</button>
    `;

    openModal(html);

    // Выбор ученика по клику
    document.querySelectorAll('.student-chip').forEach(chip => {
        chip.addEventListener('click', function() {
            document.querySelectorAll('.student-chip').forEach(c => c.classList.remove('selected'));
            this.classList.add('selected');
            document.getElementById('manual-student').value = '';
        });
    });

    // Выбор повтора
    document.querySelectorAll('.repeat-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.repeat-btn').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
        });
    });

    // Выбор напоминания
    document.querySelectorAll('.reminder-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.reminder-btn').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
        });
    });

    document.getElementById('submit-lesson').addEventListener('click', () => {
        // Собираем данные
        const selectedStudent = document.querySelector('.student-chip.selected');
        const manualName = document.getElementById('manual-student').value.trim();
        const studentName = selectedStudent ? selectedStudent.dataset.name : (manualName || '');
        const studentId = selectedStudent ? selectedStudent.dataset.id : '';

        const date = document.getElementById('lesson-date').value;
        const time = document.getElementById('lesson-time').value;
        const repeat = document.querySelector('.repeat-btn.selected')?.dataset.value || 'no';
        const reminder = document.querySelector('.reminder-btn.selected')?.dataset.value || '60';
        const zoom = document.getElementById('lesson-zoom').value.trim();

        if (!studentName) {
            alert('Выберите или введите имя ученика');
            return;
        }

        if (!date || !time) {
            alert('Выберите дату и время');
            return;
        }

        // Формируем ключ даты для бота
        const dateParts = date.split('-');
        const dateKey = `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`;

        // Отправляем боту
        tg.sendData(JSON.stringify({
            action: 'add_lesson',
            user_id: user.id,
            date: dateKey,
            time: time,
            student: studentName,
            student_id: studentId || `manual_${Date.now()}`,
            repeat: repeat,
            reminder: parseInt(reminder),
            zoom: zoom
        }));

        closeModal();
        loadSchedule();
    });

    document.getElementById('cancel-lesson').addEventListener('click', closeModal);
}

// ============================================================
// ВЫБОР ВРЕМЕНИ (редактирование слота)
// ============================================================

function openTimePicker(oldTime) {
    const html = `
        <h2 style="margin-bottom:16px;">🕐 Изменить время</h2>
        <p style="margin-bottom:12px;font-size:14px;color:#888;">Текущее: ${oldTime}</p>
        <div class="form-group">
            <label>Новое время</label>
            <input type="time" id="new-time" value="${oldTime}" step="300" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;font-size:16px;">
        </div>
        <button id="submit-time" class="submit-btn">✅ Сохранить</button>
        <button id="cancel-time" class="submit-btn cancel-btn" style="margin-top:8px;">❌ Отмена</button>
    `;

    openModal(html);

    document.getElementById('submit-time').addEventListener('click', () => {
        const newTime = document.getElementById('new-time').value;
        if (!newTime) {
            alert('Выберите время');
            return;
        }

        tg.sendData(JSON.stringify({
            action: 'edit_time',
            user_id: user.id,
            old_time: oldTime,
            new_time: newTime
        }));

        closeModal();
        loadSchedule();
    });

    document.getElementById('cancel-time').addEventListener('click', closeModal);
}

// ============================================================
// УДАЛЕНИЕ ЗАНЯТИЯ
// ============================================================

function confirmDeleteLesson(time) {
    const html = `
        <h2 style="margin-bottom:12px;">🗑 Удалить занятие</h2>
        <p style="margin-bottom:16px;">Вы уверены, что хотите удалить занятие в <strong>${time}</strong>?</p>
        <button id="confirm-delete" class="submit-btn" style="background:#ff3b30;">🗑 Да, удалить</button>
        <button id="cancel-delete" class="submit-btn cancel-btn" style="margin-top:8px;">❌ Отмена</button>
    `;

    openModal(html);

    document.getElementById('confirm-delete').addEventListener('click', () => {
        tg.sendData(JSON.stringify({
            action: 'delete_lesson',
            user_id: user.id,
            time: time
        }));
        closeModal();
        loadSchedule();
    });

    document.getElementById('cancel-delete').addEventListener('click', closeModal);
}

// ============================================================
// РЕДАКТИРОВАНИЕ НАПОМИНАНИЯ
// ============================================================

function openReminderModal(time) {
    const html = `
        <h2 style="margin-bottom:16px;">🔔 Напоминание для ${time}</h2>
        <div class="form-group">
            <label>Время напоминания (минут)</label>
            <div class="reminder-options">
                <button class="reminder-btn" data-value="5">5</button>
                <button class="reminder-btn" data-value="15">15</button>
                <button class="reminder-btn" data-value="30">30</button>
                <button class="reminder-btn selected" data-value="60">60</button>
                <button class="reminder-btn" data-value="120">120</button>
                <button class="reminder-btn" data-value="0">Выкл</button>
            </div>
        </div>
        <button id="submit-reminder" class="submit-btn">✅ Сохранить</button>
        <button id="cancel-reminder" class="submit-btn cancel-btn" style="margin-top:8px;">❌ Отмена</button>
    `;

    openModal(html);

    document.querySelectorAll('.reminder-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.reminder-btn').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
        });
    });

    document.getElementById('submit-reminder').addEventListener('click', () => {
        const reminder = document.querySelector('.reminder-btn.selected')?.dataset.value || '60';
        tg.sendData(JSON.stringify({
            action: 'set_reminder',
            user_id: user.id,
            time: time,
            minutes: parseInt(reminder)
        }));
        closeModal();
        loadSchedule();
    });

    document.getElementById('cancel-reminder').addEventListener('click', closeModal);
}

// ============================================================
// НАСТРОЙКИ (вызов настроек бота)
// ============================================================

btnSettings.addEventListener('click', () => {
    tg.sendData(JSON.stringify({
        action: 'settings',
        user_id: user.id
    }));
});

// ============================================================
// НАВИГАЦИЯ ПО НЕДЕЛЯМ
// ============================================================

btnPrev.addEventListener('click', () => {
    state.weekOffset--;
    state.selectedDay = 0;
    loadSchedule();
});

btnNext.addEventListener('click', () => {
    state.weekOffset++;
    state.selectedDay = 0;
    loadSchedule();
});

btnToday.addEventListener('click', () => {
    state.weekOffset = 0;
    const now = new Date();
    state.selectedDay = now.getDay() === 0 ? 6 : now.getDay() - 1; // ПН = 0
    loadSchedule();
});

btnAdd.addEventListener('click', () => {
    openAddLessonModal('10:00');
});

// ============================================================
// ЗАПУСК
// ============================================================

// Загружаем начальные данные
loadSchedule();
loadStudents();
loadSlots();

console.log('📱 Mini App запущен!');
console.log('👤 Пользователь:', user);