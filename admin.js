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

async function renderTable(justCreated, justBooked) {
  const { data: rawSessions } = await client.models.Session.list();
  // AppSync nulls out individual list items (rather than failing the whole
  // query) when a stored record can't satisfy a non-null field on read -
  // e.g. legacy Session rows written before `booked` was added to the
  // schema. Drop those instead of letting a single bad row crash the table.
  const sessions = rawSessions.filter(Boolean);
  // DynamoDB's list Scan is not strongly consistent, so re-querying right
  // after a create can occasionally still miss the row that was just
  // written - this was the actual cause of "success" being shown with the
  // new session never appearing in the table below it. Splice it in from
  // what create() already returned rather than trusting the re-fetch alone.
  if (justCreated && !sessions.some((s) => s.id === justCreated.id)) {
    sessions.push(justCreated);
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const wrap = document.getElementById('sessionsTableWrap');

  if (sessions.length === 0) {
    wrap.innerHTML = '<p style="color:#999;font-size:.9rem">No sessions yet. Add one above.</p>';
    return;
  }

  const rowsHtml = await Promise.all(sessions.map(async (s) => {
    const { data: rawBookings } = await client.models.Booking.list({ filter: { sessionId: { eq: s.id } } });
    const bookings = rawBookings.filter(Boolean);
    // Same list-consistency gap as the session splice above, but for the
    // booking a "Book for User" submit just created on this session.
    if (justBooked && justBooked.sessionId === s.id && !bookings.some((b) => b.id === justBooked.booking.id)) {
      bookings.push(justBooked.booking);
    }
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
      <td class="admin-actions">
        <button class="btn btn-outline btn-sm" data-action="edit" data-id="${s.id}">Edit</button>
        ${s.booked
          ? `<button class="btn btn-danger btn-sm" data-action="cancel-booking" data-id="${s.id}">Cancel Booking</button>`
          : `<button class="btn btn-primary btn-sm" data-action="book-for-user" data-id="${s.id}">Book for User</button>`}
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${s.id}">Delete</button>
      </td>
    </tr>
    <tr class="expando-row" id="edit-row-${s.id}" style="display:none">
      <td colspan="6">
        <form class="admin-form" data-edit-id="${s.id}">
          <div class="form-group">
            <label for="editDate-${s.id}">Date</label>
            <input type="date" id="editDate-${s.id}" name="date" value="${s.date}" min="${todayISO()}" required />
          </div>
          <div class="form-group">
            <label for="editTime-${s.id}">Time</label>
            <input type="time" id="editTime-${s.id}" name="time" value="${s.time}" required />
          </div>
          <div class="form-group">
            <label for="editDuration-${s.id}">Duration (min)</label>
            <input type="number" id="editDuration-${s.id}" name="duration" value="${s.duration}" min="15" max="240" required />
          </div>
          <div class="form-group full-width">
            <label for="editTitle-${s.id}">Session Title</label>
            <input type="text" id="editTitle-${s.id}" name="title" value="${escapeHtml(s.title)}" required />
          </div>
          <div class="form-group full-width admin-form-actions">
            <button type="button" class="btn btn-outline btn-sm" data-action="cancel-edit" data-id="${s.id}">Close</button>
            <button type="submit" class="btn btn-primary btn-sm">Save Changes</button>
          </div>
        </form>
        <div class="alert alert-error" id="editError-${s.id}" style="display:none"></div>
      </td>
    </tr>
    ${!s.booked ? `
    <tr class="expando-row" id="book-row-${s.id}" style="display:none">
      <td colspan="6">
        <form class="admin-form" data-book-id="${s.id}">
          <div class="form-group">
            <label for="bookMode-${s.id}">Format</label>
            <select id="bookMode-${s.id}" name="mode" data-action="book-mode-change" data-id="${s.id}">
              <option value="ONE_ON_ONE">1-on-1</option>
              <option value="ONE_ON_TWO">1-on-2</option>
            </select>
          </div>
          <div class="form-group">
            <label for="bookGuardianName-${s.id}">Guardian Name</label>
            <input type="text" id="bookGuardianName-${s.id}" name="userName" required />
          </div>
          <div class="form-group">
            <label for="bookGuardianEmail-${s.id}">Guardian Email</label>
            <input type="email" id="bookGuardianEmail-${s.id}" name="userEmail" required />
          </div>
          <div class="form-group">
            <label for="bookPlayerName-${s.id}">Player Name</label>
            <input type="text" id="bookPlayerName-${s.id}" name="playerName" required />
          </div>
          <div class="form-group full-width" id="bookP2Group-${s.id}" style="display:none">
            <label for="bookPlayerName2-${s.id}">Second Player (optional)</label>
            <input type="text" id="bookPlayerName2-${s.id}" name="playerName2" maxlength="60" placeholder="Sibling or friend's name" />
          </div>
          <div class="form-group full-width admin-form-actions">
            <button type="button" class="btn btn-outline btn-sm" data-action="cancel-book" data-id="${s.id}">Close</button>
            <button type="submit" class="btn btn-primary btn-sm">Book Session</button>
          </div>
        </form>
        <div class="alert alert-error" id="bookError-${s.id}" style="display:none"></div>
      </td>
    </tr>` : ''}`;
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
  wrap.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleRow(`edit-row-${btn.dataset.id}`, `book-row-${btn.dataset.id}`));
  });
  wrap.querySelectorAll('[data-action="cancel-edit"]').forEach((btn) => {
    btn.addEventListener('click', () => hideRow(`edit-row-${btn.dataset.id}`));
  });
  wrap.querySelectorAll('[data-action="book-for-user"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleRow(`book-row-${btn.dataset.id}`, `edit-row-${btn.dataset.id}`));
  });
  wrap.querySelectorAll('[data-action="cancel-book"]').forEach((btn) => {
    btn.addEventListener('click', () => hideRow(`book-row-${btn.dataset.id}`));
  });
  wrap.querySelectorAll('[data-action="cancel-booking"]').forEach((btn) => {
    btn.addEventListener('click', () => cancelBooking(btn.dataset.id));
  });
  wrap.querySelectorAll('[data-action="book-mode-change"]').forEach((select) => {
    select.addEventListener('change', () => {
      const group = document.getElementById(`bookP2Group-${select.dataset.id}`);
      group.style.display = select.value === 'ONE_ON_TWO' ? '' : 'none';
    });
  });
  wrap.querySelectorAll('form[data-edit-id]').forEach((form) => {
    form.addEventListener('submit', (e) => { e.preventDefault(); saveEditSession(form.dataset.editId, form); });
  });
  wrap.querySelectorAll('form[data-book-id]').forEach((form) => {
    form.addEventListener('submit', (e) => { e.preventDefault(); submitBookForUser(form.dataset.bookId, form); });
  });
}

function hideRow(id) {
  const row = document.getElementById(id);
  if (row) row.style.display = 'none';
}

function toggleRow(id, otherIdToClose) {
  hideRow(otherIdToClose);
  const row = document.getElementById(id);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
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

  // Amplify Data mutations resolve with { data, errors } instead of throwing
  // on GraphQL/authorization failures - without this check a failed create
  // still fell through to the "success" banner below despite nothing being
  // written, which is exactly the bug this comment is guarding against.
  const { data: created, errors } = await client.models.Session.create({ title, date, time, duration, booked: false });
  if (errors?.length) {
    const el = document.getElementById('addError');
    el.textContent = errors[0].message || 'Failed to add session.';
    el.style.display = 'block';
    return;
  }

  document.getElementById('addSuccess').style.display = 'block';
  document.getElementById('addForm').reset();
  document.getElementById('newDuration').value = 60;
  document.getElementById('newTitle').value = 'Shooting Skills Session';
  document.getElementById('newDate').min = todayISO();

  try {
    await renderTable(created);
  } catch (err) {
    // A render-step failure here would otherwise fail silently (console
    // only) right after the success banner, looking exactly like the
    // session vanished - surface it instead of hiding it.
    const el = document.getElementById('addError');
    el.textContent = `Session was saved, but the table failed to refresh: ${err.message || err}`;
    el.style.display = 'block';
  }
}

async function saveEditSession(id, form) {
  const errEl = document.getElementById(`editError-${id}`);
  errEl.style.display = 'none';

  const date = form.date.value;
  const time = form.time.value;
  const duration = parseInt(form.duration.value);
  const title = form.title.value.trim();

  if (isPastDate(date)) {
    errEl.textContent = 'Session date must be today or in the future.';
    errEl.style.display = 'block';
    return;
  }

  const { errors } = await client.models.Session.update({ id, date, time, duration, title });
  if (errors?.length) {
    errEl.textContent = errors[0].message || 'Failed to save changes.';
    errEl.style.display = 'block';
    return;
  }

  await renderTable();
}

async function cancelBooking(id) {
  if (!confirm("Cancel this session's booking? This frees up the slot without deleting the session itself.")) return;
  const { data: bookings } = await client.models.Booking.list({ filter: { sessionId: { eq: id } } });
  await Promise.all(bookings.map((b) => client.models.Booking.delete({ id: b.id })));
  await client.models.Session.update({ id, booked: false });
  await renderTable();
}

async function submitBookForUser(id, form) {
  const errEl = document.getElementById(`bookError-${id}`);
  errEl.style.display = 'none';

  const mode = form.mode.value;
  const userName = form.userName.value.trim();
  const userEmail = form.userEmail.value.trim();
  const playerName = form.playerName.value.trim();
  const playerName2 = mode === 'ONE_ON_TWO' ? form.playerName2.value.trim() : '';

  const { data: s } = await client.models.Session.get({ id });
  if (!s) return;

  // Admins have no way to look up another user's real Cognito identity from
  // the client (no directory API wired up), so this booking is owned by the
  // admin's own account rather than the guardian's - it'll show up here and
  // in the session's "Who" list, but not on that guardian's own My Bookings
  // page. Good enough for "coach takes a booking over the phone"; a real fix
  // needs an admin-only user-lookup Lambda.
  const { data: created, errors } = await client.models.Booking.create({
    sessionId: id,
    sessionDate: s.date,
    userName,
    userEmail,
    mode,
    playerName,
    ...(playerName2 ? { playerName2 } : {}),
  });
  if (errors?.length) {
    errEl.textContent = errors[0].message || 'Failed to book this session.';
    errEl.style.display = 'block';
    return;
  }

  await client.models.Session.update({ id, booked: true });
  await renderTable(null, { sessionId: id, booking: created });
}

async function deleteSession(id) {
  if (!confirm('Delete this session? All bookings for it will be lost.')) return;
  const { data: bookings } = await client.models.Booking.list({ filter: { sessionId: { eq: id } } });
  await Promise.all(bookings.map((b) => client.models.Booking.delete({ id: b.id })));
  await client.models.Session.delete({ id });
  await renderTable();
}
