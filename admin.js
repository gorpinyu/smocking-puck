import { client, isAdmin, escapeHtml, formatDate, formatTime, todayISO, isPastDate, bookingModeLabel, renderNav, renderFooter } from './app.js';

// Attached immediately (not gated behind the async admin check below) so a
// submit before that check resolves is handled by our code, not a native
// full-page form submission that silently drops the data.
document.getElementById('addForm').addEventListener('submit', addSession);

(async () => {
  const admin = await isAdmin();

  if (!admin) {
    document.getElementById('accessDenied').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
    return;
  }

  document.getElementById('dashboard').style.display = 'block';
  await renderNav();
  await renderFooter();

  document.getElementById('newDate').min = todayISO();

  await renderTable();
})();

async function renderTable() {
  const { data: sessions } = await client.models.Session.list();
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const wrap = document.getElementById('sessionsTableWrap');

  if (sessions.length === 0) {
    wrap.innerHTML = '<p style="color:#999;font-size:.9rem">No sessions yet. Add one above.</p>';
    return;
  }

  const rowsHtml = await Promise.all(sessions.map(async (s) => {
    const { data: bookings } = await client.models.Booking.list({ filter: { sessionId: { eq: s.id } } });
    const who = bookings.length
      ? bookings.map((b) => {
          // playerName fallback covers bookings created before the Player rollout
          const players = b.playerName2
            ? `${escapeHtml(b.playerName)} &amp; ${escapeHtml(b.playerName2)}`
            : escapeHtml(b.playerName || b.userName);
          return `${bookingModeLabel(b.mode)}: ${players} &lt;${escapeHtml(b.userEmail)}&gt;`;
        }).join('<br>')
      : '<span style="color:#bbb">—</span>';

    return `<tr>
      <td>${formatDate(s.date)}</td>
      <td>${formatTime(s.time)}</td>
      <td>${escapeHtml(s.title)}</td>
      <td style="text-align:center">${s.booked ? 'Booked' : 'Open'}</td>
      <td class="who">${who}</td>
      <td><button class="btn btn-danger btn-sm" data-action="delete" data-id="${s.id}">Delete</button></td>
    </tr>`;
  }));

  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Time</th>
          <th>Title</th>
          <th>Status</th>
          <th>Who</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rowsHtml.join('')}</tbody>
    </table>`;

  wrap.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => deleteSession(btn.dataset.id));
  });
}

async function addSession(e) {
  e.preventDefault();
  document.getElementById('addSuccess').style.display = 'none';
  document.getElementById('addError').style.display = 'none';

  const date = document.getElementById('newDate').value;
  const time = document.getElementById('newTime').value;
  const duration = parseInt(document.getElementById('newDuration').value);
  const title = document.getElementById('newTitle').value.trim();

  if (isPastDate(date)) {
    const el = document.getElementById('addError');
    el.textContent = 'Session date must be today or in the future.';
    el.style.display = 'block';
    return;
  }

  await client.models.Session.create({ title, date, time, duration, booked: false });

  document.getElementById('addSuccess').style.display = 'block';
  document.getElementById('addForm').reset();
  document.getElementById('newDuration').value = 60;
  document.getElementById('newTitle').value = 'Shooting Skills Session';
  document.getElementById('newDate').min = todayISO();

  await renderTable();
}

async function deleteSession(id) {
  if (!confirm('Delete this session? All bookings for it will be lost.')) return;
  const { data: bookings } = await client.models.Booking.list({ filter: { sessionId: { eq: id } } });
  await Promise.all(bookings.map((b) => client.models.Booking.delete({ id: b.id })));
  await client.models.Session.delete({ id });
  await renderTable();
}
