import { client, isLoggedIn, escapeHtml, formatDate, formatTime, formatDateTime, isPastDate, bookingModeLabel, renderNav, renderFooter } from './app.js';

(async () => {
  if (!(await isLoggedIn())) {
    window.location.href = 'login.html';
    return;
  }
  await renderNav();
  await renderFooter();
  await renderBookings();
  await renderHistory();
})();

async function renderHistory() {
  const { data: rawEvents } = await client.models.BookingHistory.list();
  // Same AppSync null-item behavior as Session.list() elsewhere.
  const events = rawEvents.filter(Boolean);
  const wrap = document.getElementById('historyWrap');

  if (events.length === 0) {
    wrap.innerHTML = '<p style="color:#999;font-size:.9rem">No activity yet.</p>';
    return;
  }

  const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>When</th><th>Action</th><th>Session</th><th>Format / Player</th></tr>
      </thead>
      <tbody>
        ${sorted.map((ev) => {
          const players = ev.playerName2
            ? `${escapeHtml(ev.playerName)} &amp; ${escapeHtml(ev.playerName2)}`
            : escapeHtml(ev.playerName || '');
          return `<tr>
            <td>${formatDateTime(ev.createdAt)}</td>
            <td>${ev.action === 'BOOKED' ? '<span class="badge badge-booked">Booked</span>' : '<span class="badge badge-full">Cancelled</span>'}</td>
            <td>${escapeHtml(ev.sessionTitle)} — ${formatDate(ev.sessionDate)} ${formatTime(ev.sessionTime)}</td>
            <td>${ev.mode ? `${bookingModeLabel(ev.mode)} · ${players}` : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function renderBookings() {
  const { data: bookings } = await client.models.Booking.list();
  // Same AppSync null-item behavior as Session.list() elsewhere (a legacy
  // row missing a since-added required field) - drop it instead of letting
  // it crash rendering below.
  const upcoming = bookings.filter(Boolean).filter((b) => !isPastDate(b.sessionDate));

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
  list.innerHTML = rows.map(({ booking, session: s }, i) => {
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
      <button class="btn btn-danger btn-sm" data-action="cancel" data-row-index="${i}">Cancel</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
    btn.addEventListener('click', () => cancelBooking(rows[Number(btn.dataset.rowIndex)]));
  });
}

async function cancelBooking({ booking, session: s }) {
  if (!confirm('Cancel this session booking?')) return;
  await client.models.Booking.delete({ id: booking.id });
  await client.models.Session.update({ id: s.id, booked: false });
  await client.models.BookingHistory.create({
    action: 'CANCELLED',
    sessionId: s.id,
    sessionDate: s.date,
    sessionTime: s.time,
    sessionTitle: s.title,
    userName: booking.userName,
    userEmail: booking.userEmail,
    mode: booking.mode,
    playerName: booking.playerName,
    ...(booking.playerName2 ? { playerName2: booking.playerName2 } : {}),
  });
  await renderBookings();
  await renderHistory();
}
