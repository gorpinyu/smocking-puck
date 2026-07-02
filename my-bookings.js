import { client, isLoggedIn, escapeHtml, formatDate, formatTime, isPastDate, bookingModeLabel, renderNav, renderFooter } from './app.js';

(async () => {
  if (!(await isLoggedIn())) {
    window.location.href = 'login.html';
    return;
  }
  await renderNav();
  await renderFooter();
  await renderBookings();
})();

async function renderBookings() {
  const { data: bookings } = await client.models.Booking.list();
  const upcoming = bookings.filter((b) => !isPastDate(b.sessionDate));

  const sessionResults = await Promise.all(
    upcoming.map((b) => client.models.Session.get({ id: b.sessionId })),
  );
  const rows = upcoming
    .map((booking, i) => ({ booking, session: sessionResults[i].data }))
    .filter((r) => r.session)
    .sort((a, b) => a.session.date.localeCompare(b.session.date) || a.session.time.localeCompare(b.session.time));

  const list = document.getElementById('bookingsList');
  const empty = document.getElementById('emptyState');

  if (rows.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  list.style.display = 'flex';
  empty.style.display = 'none';
  list.innerHTML = rows.map(({ booking, session: s }) => {
    const players = booking.playerName2
      ? `${escapeHtml(booking.playerName)} &amp; ${escapeHtml(booking.playerName2)}`
      : escapeHtml(booking.playerName);
    return `
    <div class="card booking-card">
      <div class="booking-info">
        <div class="session-date">${formatDate(s.date)}</div>
        <h3>${escapeHtml(s.title)}</h3>
        <div class="session-meta">
          ⏰ ${formatTime(s.time)} &nbsp;·&nbsp; ⏱ ${s.duration} min
        </div>
        ${booking.playerName ? `<div class="session-meta">🏒 ${bookingModeLabel(booking.mode)} &nbsp;·&nbsp; 👤 ${players}</div>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" data-action="cancel" data-booking-id="${booking.id}" data-session-id="${s.id}">Cancel</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
    btn.addEventListener('click', () => cancelBooking(btn.dataset.bookingId, btn.dataset.sessionId));
  });
}

async function cancelBooking(bookingId, sessionId) {
  if (!confirm('Cancel this session booking?')) return;
  await client.models.Booking.delete({ id: bookingId });
  await client.models.Session.update({ id: sessionId, booked: false });
  await renderBookings();
}
