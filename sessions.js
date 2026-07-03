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
  const { data: rawSessions } = await client.models.Session.list(
    user ? {} : { authMode: 'identityPool' },
  );
  // AppSync nulls out individual list items (rather than failing the whole
  // query) when a stored record can't satisfy a non-null field on read -
  // e.g. legacy Session rows written before `booked` was added to the
  // schema. Drop those instead of letting a single bad row crash the page.
  const sessions = rawSessions.filter(Boolean);

  const upcoming = sessions
    .filter((s) => !isPastDate(s.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  let myBookings = [];
  let myPlayers = [];
  if (user) {
    const [bookingsRes, playersRes] = await Promise.all([
      client.models.Booking.list(),
      client.models.Player.list(),
    ]);
    myBookings = bookingsRes.data;
    myPlayers = playersRes.data.sort((a, b) => a.name.localeCompare(b.name));
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
  grid.innerHTML = upcoming.map((s, i) => buildCard(s, user, myBookings, myPlayers, i)).join('');

  grid.querySelectorAll('[data-action="book"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById(`bf-${btn.dataset.id}`);
      form.style.display = form.style.display === 'none' ? '' : 'none';
    });
  });
  grid.querySelectorAll('[data-action="mode-change"]').forEach((select) => {
    select.addEventListener('change', () => {
      const group = document.getElementById(`bp2-group-${select.dataset.id}`);
      group.style.display = select.value === 'ONE_ON_TWO' ? '' : 'none';
    });
  });
  grid.querySelectorAll('[data-action="confirm-book"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const mode = document.getElementById(`bm-${id}`).value;
      const playerName = document.getElementById(`bp-${id}`).value;
      const secondInput = document.getElementById(`bp2-${id}`);
      const playerName2 = mode === 'ONE_ON_TWO' && secondInput ? secondInput.value.trim() : '';
      bookSession(id, mode, playerName, playerName2);
    });
  });
}

function buildCard(s, user, myBookings, myPlayers, i) {
  const isBooked = user && myBookings.some((b) => b.sessionId === s.id);

  let action;
  let bookForm = '';
  if (isBooked) {
    action = `<span class="badge badge-booked">Booked ✓</span>`;
  } else if (s.booked) {
    action = `<span class="badge badge-full">Booked</span>`;
  } else if (!user) {
    action = `<a href="login.html" class="btn btn-primary btn-sm">Book Now</a>`;
  } else {
    action = `<button class="btn btn-primary btn-sm" data-action="book" data-id="${s.id}">Book Now</button>`;
    bookForm = buildBookForm(s, myPlayers);
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
        ${action}
      </div>
      ${bookForm}
    </div>`;
}

function buildBookForm(s, myPlayers) {
  if (myPlayers.length === 0) {
    return `
      <div class="book-form" id="bf-${s.id}" style="display:none">
        <p class="book-form-note">
          You need a saved player to book.
          <a href="players.html">Add a player →</a>
        </p>
      </div>`;
  }

  return `
    <div class="book-form" id="bf-${s.id}" style="display:none">
      <div class="form-group">
        <label for="bm-${s.id}">Format</label>
        <select id="bm-${s.id}" data-action="mode-change" data-id="${s.id}">
          <option value="ONE_ON_ONE">1-on-1</option>
          <option value="ONE_ON_TWO">1-on-2</option>
        </select>
      </div>
      <div class="form-group">
        <label for="bp-${s.id}">Player</label>
        <select id="bp-${s.id}">
          ${myPlayers.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="bp2-group-${s.id}" style="display:none">
        <label for="bp2-${s.id}">Second player (optional)</label>
        <input type="text" id="bp2-${s.id}" maxlength="60" placeholder="Sibling or friend's name" />
      </div>
      <button class="btn btn-primary btn-sm" data-action="confirm-book" data-id="${s.id}">Confirm Booking</button>
    </div>`;
}

async function bookSession(id, mode, playerName, playerName2) {
  const user = await getCurrentUser();
  if (!user) { window.location.href = 'login.html'; return; }
  if (!playerName) return;

  const { data: s } = await client.models.Session.get({ id });
  if (!s) return;

  const { data: existing } = await client.models.Booking.list();
  if (existing.some((b) => b.sessionId === id) || s.booked) return;

  await client.models.Booking.create({
    sessionId: id,
    sessionDate: s.date,
    userName: user.name,
    userEmail: user.email,
    mode,
    playerName,
    ...(playerName2 ? { playerName2 } : {}),
  });
  await client.models.Session.update({ id, booked: true });
  await renderSessions();
}
