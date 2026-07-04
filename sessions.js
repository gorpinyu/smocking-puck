import { client, getCurrentUser, escapeHtml, formatDate, formatTime, isPastDate, isWithinBookingCutoff, renderNav, renderFooter } from './app.js';

(async () => {
  await renderNav();
  await renderFooter();
  try {
    await renderSessions();
  } catch (err) {
    // Without this, any uncaught error here (e.g. a future null-item
    // regression) leaves the page silently blank - nav/footer already
    // rendered, but no cards, no #emptyState, no #loadError, nothing to
    // debug from. Surface it instead.
    console.error('renderSessions failed:', err);
    const el = document.getElementById('loadError');
    el.textContent = `Couldn't load sessions: ${err.message || 'unknown error'}`;
    el.style.display = 'block';
  }
})();

async function renderSessions() {
  const user = await getCurrentUser();
  // Browsing is public - guests must use the IAM/guest auth mode since the
  // client's default (userPool) only satisfies the "authenticated" rule.
  const { data: rawSessions, errors } = await client.models.Session.list(
    user ? {} : { authMode: 'identityPool' },
  );
  // list() resolves with { data, errors } instead of throwing on a GraphQL/
  // authorization failure. But errors here aren't necessarily fatal: a
  // single legacy row missing a non-null field (e.g. `booked` on a Session
  // written before that field existed) makes AppSync attach an error *and*
  // null out just that one item, while every other item still comes back
  // fine in `data`. Only treat this as a real failure when there's no
  // usable data at all - otherwise fall through and let the null-filter
  // below drop the bad row like it already does.
  if (errors?.length && !rawSessions) {
    const el = document.getElementById('loadError');
    el.textContent = `Couldn't load sessions: ${errors[0].message || 'unknown error'}`;
    el.style.display = 'block';
    return;
  }
  if (errors?.length) {
    console.warn('Session.list() returned partial data with errors (likely a corrupted legacy row):', errors);
  }
  // AppSync nulls out individual list items (rather than failing the whole
  // query) when a stored record can't satisfy a non-null field on read -
  // e.g. legacy Session rows written before `booked` was added to the
  // schema. Drop those instead of letting a single bad row crash the page.
  const sessions = rawSessions.filter(Boolean);

  const upcoming = sessions
    .filter((s) => !isPastDate(s.date))
    // An unbooked session within an hour of its start (or already started
    // today) is too late for a walk-in booking - drop it the same as a past
    // session. A booked one still shows so its "Booked" badge stays visible.
    .filter((s) => s.booked || !isWithinBookingCutoff(s.date, s.time))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  let myBookings = [];
  let myPlayers = [];
  if (user) {
    const [bookingsRes, playersRes] = await Promise.all([
      client.models.Booking.list(),
      client.models.Player.list(),
    ]);
    // Same AppSync null-item behavior as Session.list() above (a legacy row
    // missing a since-added required field), but Booking/Player never had
    // this filter - a null entry here crashed buildCard()'s myBookings.some()
    // before any of sessions.js's own render/error branches could run,
    // leaving the page blank with no visible error.
    myBookings = bookingsRes.data.filter(Boolean);
    myPlayers = playersRes.data.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  const grid = document.getElementById('sessionsGrid');
  const empty = document.getElementById('emptyState');

  if (upcoming.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    // Distinguish "genuinely nothing scheduled" from "sessions exist but
    // none are upcoming" / "sessions exist but failed to load" instead of
    // always showing the same generic message - the three have different
    // causes and otherwise look identical from the outside.
    const msg = empty.querySelector('p');
    if (rawSessions.length === 0) {
      msg.textContent = 'No upcoming sessions right now — check back soon!';
    } else if (sessions.length === 0) {
      msg.textContent = `Found ${rawSessions.length} session record(s), but none could be read (a data issue, not "no sessions") — check the Admin dashboard.`;
    } else {
      msg.textContent = `Found ${sessions.length} session record(s), but none are currently open (either dated in the past, or unbooked and starting within the hour).`;
    }
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
  if (existing.filter(Boolean).some((b) => b.sessionId === id) || s.booked) return;

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
  await client.models.BookingHistory.create({
    action: 'BOOKED',
    sessionId: id,
    sessionDate: s.date,
    sessionTime: s.time,
    sessionTitle: s.title,
    userName: user.name,
    userEmail: user.email,
    mode,
    playerName,
    ...(playerName2 ? { playerName2 } : {}),
  });
  await renderSessions();
}
