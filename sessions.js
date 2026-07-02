import { client, getCurrentUser, escapeHtml, formatDate, formatTime, isPastDate, renderNav, renderFooter } from './app.js';

(async () => {
  await renderNav();
  await renderFooter();
  await renderSessions();
})();

async function renderSessions() {
  const user = await getCurrentUser();
  // Browsing is public - guests must use the IAM/guest auth mode since the
  // client's default (userPool) only satisfies the "authenticated" rule.
  const { data: sessions } = await client.models.Session.list(
    user ? {} : { authMode: 'identityPool' },
  );

  const upcoming = sessions
    .filter((s) => !isPastDate(s.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  let myBookings = [];
  if (user) {
    const { data } = await client.models.Booking.list();
    myBookings = data;
  }

  const grid = document.getElementById('sessionsGrid');
  const empty = document.getElementById('emptyState');

  if (upcoming.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';
  grid.innerHTML = upcoming.map((s, i) => buildCard(s, user, myBookings, i)).join('');

  grid.querySelectorAll('[data-action="book"]').forEach((btn) => {
    btn.addEventListener('click', () => bookSession(btn.dataset.id));
  });
}

function buildCard(s, user, myBookings, i) {
  const spotsLeft = s.maxCapacity - s.bookedCount;
  const isFull = spotsLeft <= 0;
  const isBooked = user && myBookings.some((b) => b.sessionId === s.id);

  let action;
  if (isBooked) {
    action = `<span class="badge badge-booked">Booked ✓</span>`;
  } else if (isFull) {
    action = `<span class="badge badge-full">Session Full</span>`;
  } else if (!user) {
    action = `<a href="login.html" class="btn btn-primary btn-sm">Book Now</a>`;
  } else {
    action = `<button class="btn btn-primary btn-sm" data-action="book" data-id="${s.id}">Book Now</button>`;
  }

  return `
    <div class="card session-card animate-in" style="animation-delay:${i * 0.07}s" id="sc-${s.id}">
      <div class="session-card-top">
        <span class="session-date">${formatDate(s.date)}</span>
      </div>
      <h3>${escapeHtml(s.title)}</h3>
      <div class="session-meta">
        <span>⏰ ${formatTime(s.time)}</span>
        <span>⏱ ${s.duration} min session</span>
      </div>
      <div class="session-footer">
        <span class="spots${isFull ? ' full' : ''}">
          ${isFull ? 'Full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
        </span>
        ${action}
      </div>
    </div>`;
}

async function bookSession(id) {
  const user = await getCurrentUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const { data: s } = await client.models.Session.get({ id });
  if (!s) return;

  const { data: existing } = await client.models.Booking.list();
  if (existing.some((b) => b.sessionId === id) || s.bookedCount >= s.maxCapacity) return;

  await client.models.Booking.create({
    sessionId: id,
    sessionDate: s.date,
    userName: user.name,
    userEmail: user.email,
  });
  await client.models.Session.update({ id, bookedCount: s.bookedCount + 1 });
  await renderSessions();
}
