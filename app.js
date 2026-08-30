const tg = window.Telegram.WebApp;
tg.expand();

let user = tg.initDataUnsafe?.user || { id: 380819371, first_name: 'Преподаватель' };
const API_URL = 'https://bot-1787954043-4984-solo1986.bothost.tech/api';

const state = {
    currentMonday: getMonday(new Date()),
    schedule: {},
    students: {},
    selectedLesson: null,
    isMoving: false
};

// ... (функции getMonday, formatDateKey, fetchWeekSchedule, fetchStudents из прошлого ответа) ...

function renderEvents() {
    const layer = document.getElementById('events-layer');
    layer.innerHTML = '';
    const colWidth = layer.clientWidth / 7;

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const d = new Date(state.currentMonday);
        d.setDate(d.getDate() + dayIndex);
        const dateKey = formatDateKey(d);
        const lessons = state.schedule[dateKey] || [];

        lessons.forEach(lesson => {
            const [h, m] = lesson.time.split(':').map(Number);
            if (h < 6 || h > 23) return;

            const topPx = ((h - 6) * 60 + m) * (80 / 60);
            const card = document.createElement('div');
            
            const colorIdx = Math.abs(lesson.student.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 8;
            card.className = `event-card color-${colorIdx} ${state.isMoving && state.selectedLesson?.id === lesson.id ? 'moving-active' : ''}`;
            
            card.style.top = `${topPx}px`;
            card.style.left = `${dayIndex * colWidth + 2}px`;
            card.style.width = `${colWidth - 4}px`;
            card.style.height = `65px`;
            card.innerHTML = `<div class="event-title">${lesson.student}</div><div class="event-time">${lesson.time}</div>`;

            // Long Press (меню)
            card.addEventListener('touchstart', (e) => {
                longPressTimer = setTimeout(() => {
                    tg.HapticFeedback.impactOccurred('heavy');
                    openEditModal(dateKey, lesson);
                }, 500);
            });
            card.addEventListener('touchend', () => clearTimeout(longPressTimer));
            
            // Short Click (перенос)
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                if (state.isMoving) return;
                state.selectedLesson = { date: dateKey, ...lesson };
                state.isMoving = true;
                tg.HapticFeedback.impactOccurred('medium');
                document.getElementById('move-hint').classList.remove('hidden');
                renderEvents();
            });

            layer.appendChild(card);
        });
    }
}

function cancelMove() {
    state.isMoving = false;
    state.selectedLesson = null;
    document.getElementById('move-hint').classList.add('hidden');
    renderEvents();
}
