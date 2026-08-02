// Self-hosted backend (Express + Postgres on the T480), replacing AWS
// Cognito/AppSync/DynamoDB. See server/ and CLAUDE.md for the architecture.
//
// `client` below is a thin fetch shim over the same call shape the AWS
// version's `generateClient()` exposed — client.models.X.list/get/create/
// update/delete, client.queries.*, client.mutations.* — all still resolving
// to a non-throwing `{ data, errors }`. Every page script below app.js and
// login.js was written against that shape and is UNCHANGED by this rewrite;
// keeping the shape (rather than switching call sites to throw/await) was a
// deliberate choice to minimize the diff and the regression surface.

const API_BASE = '/api';

async function apiRequest(method, path, body) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    if (res.status !== 204) {
      try { payload = await res.json(); } catch { /* no/invalid JSON body */ }
    }
    if (!res.ok) {
      return { data: null, errors: [{ message: (payload && payload.error) || `Request failed (${res.status})` }] };
    }
    return { data: payload, errors: null };
  } catch (err) {
    return { data: null, errors: [{ message: err.message || 'Network error' }] };
  }
}

// Builds the client.models.<Resource> object for one REST resource. Options
// the AWS SDK version accepted that have no self-hosted equivalent —
// `authMode: 'identityPool'` (guest reads; the API just allows GET /sessions
// unauthenticated) and `selectionSet` (a DynamoDB/AppSync partial-read
// workaround with nothing to work around here) — are accepted and ignored so
// call sites didn't need to change.
function modelClient(resource) {
  return {
    list: async (opts = {}) => {
      const params = new URLSearchParams();
      if (opts.filter?.sessionId?.eq) params.set('sessionId', opts.filter.sessionId.eq);
      const qs = params.toString();
      const { data, errors } = await apiRequest('GET', `/${resource}${qs ? `?${qs}` : ''}`);
      // Only default a missing `data` to [] on a genuine empty-list success -
      // on an error, callers (e.g. sessions.js) check `errors?.length && !rawSessions`
      // and expect `data` to still be falsy.
      return { data: errors ? data : (data ?? []), errors };
    },
    get: ({ id }) => apiRequest('GET', `/${resource}/${id}`),
    create: (input) => apiRequest('POST', `/${resource}`, input),
    update: ({ id, ...fields }) => apiRequest('PATCH', `/${resource}/${id}`, fields),
    delete: ({ id }) => apiRequest('DELETE', `/${resource}/${id}`),
  };
}

export const client = {
  models: {
    Session: modelClient('sessions'),
    Booking: modelClient('bookings'),
    Player: modelClient('players'),
    BookingHistory: modelClient('booking-history'),
  },
  queries: {
    listAppUsers: () => apiRequest('GET', '/admin/users'),
  },
  mutations: {
    bookForUser: (input) => apiRequest('POST', '/admin/book-for-user', input),
    setAdminRole: ({ username, makeAdmin }) => apiRequest('POST', `/admin/users/${encodeURIComponent(username)}/admin-role`, { makeAdmin }),
  },
};

let cachedUser; // memoized per page load — avoids re-fetching on every call

export async function getCurrentUser() {
  if (cachedUser !== undefined) return cachedUser;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'same-origin' });
    if (!res.ok) {
      cachedUser = null;
      return cachedUser;
    }
    const u = await res.json();
    cachedUser = {
      id: u.id, username: u.username, name: u.name || u.email, email: u.email, isAdmin: Boolean(u.isAdmin),
    };
  } catch (err) {
    console.error('getCurrentUser: /api/auth/me request failed', err);
    cachedUser = null;
  }
  return cachedUser;
}

export async function isLoggedIn() {
  return !!(await getCurrentUser());
}

export async function isAdmin() {
  const user = await getCurrentUser();
  return !!user?.isAdmin;
}

// The self-hosted backend has no Cognito sub/Username split (that only
// existed because a Google-federated Cognito user's Username differed from
// their sub) - a user's id doubles as their "username" everywhere, so this
// is just getCurrentUser().username. Kept as its own export because
// access-management.js imports it by this name to match against the
// `username` field listAppUsers returns.
export async function getCurrentUsername() {
  const user = await getCurrentUser();
  return user?.username || null;
}

export async function logout() {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
  window.location.href = 'index.html';
}

export const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Dates are stored as 'YYYY-MM-DD', so plain string compare works.
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isPastDate = (dateStr) => dateStr < todayISO();

// A native <input type="time"> with step="300" still lets most browsers'
// pickers scroll/type any minute value, ignoring the step - so the admin time
// fields use a pair of <select>s instead, built from these, which can only
// ever offer 5-minute-step values in the first place.
export const hourSelectOptionsHTML = (selected) => Array.from({ length: 24 }, (_, h) => {
  const v = String(h).padStart(2, '0');
  return `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`;
}).join('');

export const minuteSelectOptionsHTML = (selected) => Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')).map((v) => `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`).join('');

// isPastDate only compares the date (day granularity), so a session later
// today still counts as "upcoming" right up until it starts. This closes the
// walk-in booking window an hour early (and also covers a same-day session
// whose start time has already passed, which isPastDate alone can't catch).
export const isWithinBookingCutoff = (dateStr, timeStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);
  const start = new Date(y, m - 1, d, h, min);
  return start.getTime() - Date.now() < 60 * 60 * 1000;
};

export const formatDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
};

// The booker picks the format at booking time - sessions have no fixed mode.
export const bookingModeLabel = (mode) => (mode === 'ONE_ON_TWO' ? '1-on-2' : '1-on-1');

// For BookingHistory.createdAt (a real timestamptz, serialized as ISO by the
// API) - unlike session date/time, this is a real instant, so it's fine to
// let the browser render it in local time via a normal Date object rather
// than string-splitting.
export const formatDateTime = (isoStr) => new Date(isoStr).toLocaleString('en-CA', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export const formatTime = (timeStr) => {
  const [h, min] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(min).padStart(2, '0')} ${ampm}`;
};

export async function renderNav() {
  const placeholder = document.getElementById('nav-placeholder');
  if (!placeholder) return;

  const user = await getCurrentUser();
  const admin = user ? await isAdmin() : false;
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const active = (p) => (page === p ? ' class="active"' : '');
  const firstName = user ? escapeHtml(user.name.split(' ')[0]) : '';

  // Both admin pages (session-management.html, access-management.html) share
  // this one nav entry point - the tab bar rendered by renderAdminTabs() is
  // what actually distinguishes between them, so the Admin nav item itself
  // should read as "active" from either one, not just its literal target.
  const onAdminPage = page === 'session-management.html' || page === 'access-management.html';
  const adminLink = admin ? `<li><a href="session-management.html"${onAdminPage ? ' class="active"' : ''}>Admin</a></li>` : '';
  const mobileAdminLink = admin ? `<a href="session-management.html">Admin</a>` : '';

  const desktopAuth = user
    ? `<li><span style="color:rgba(255,255,255,.8);font-weight:600;font-size:.88rem">Hi, ${firstName}!</span></li>
       <li><button class="btn-nav" data-action="logout">Logout</button></li>`
    : `<li><a href="login.html"${active('login.html')}>Login / Register</a></li>`;

  const mobileAuth = user
    ? `<span style="color:rgba(255,255,255,.7);font-size:.85rem;padding:.6rem 0;display:block">Hi, ${firstName}!</span>
       <button data-action="logout">Logout</button>`
    : `<a href="login.html">Login / Register</a>`;

  placeholder.innerHTML = `
    <nav>
      <div class="nav-inner">
        <a href="index.html" class="nav-logo">
          <img src="/logo.png" alt="" class="nav-logo-img" />
          <span class="nav-logo-text">Smocking <span class="accent-text">Puck</span></span>
        </a>
        <ul class="nav-links">
          <li><a href="sessions.html"${active('sessions.html')}>Sessions</a></li>
          <li><a href="my-bookings.html"${active('my-bookings.html')}>My Bookings</a></li>
          <li><a href="players.html"${active('players.html')}>My Players</a></li>
          ${adminLink}
          ${desktopAuth}
        </ul>
        <button class="hamburger" id="hamburgerBtn" aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
      </div>
      <div class="mobile-menu" id="mobileMenu">
        <a href="sessions.html">Sessions</a>
        <a href="my-bookings.html">My Bookings</a>
        <a href="players.html">My Players</a>
        ${mobileAdminLink}
        ${mobileAuth}
      </div>
    </nav>`;

  document.getElementById('hamburgerBtn').addEventListener('click', () => {
    document.getElementById('mobileMenu').classList.toggle('open');
    document.getElementById('hamburgerBtn').classList.toggle('open');
  });
  document.querySelectorAll('[data-action="logout"]').forEach((btn) => {
    btn.addEventListener('click', logout);
  });
}

// Sub-navigation between the two admin pages, shown inside the admin area
// itself rather than as extra top-level nav links - keeps the main nav at
// one "Admin" item regardless of role, instead of growing per admin page
// (see session-management.js/access-management.js, both call this after
// their own isAdmin() gate passes). Reuses the existing .tabs/.tab-btn CSS
// (originally built for login.html's Login/Register toggle) - these are
// plain links, not JS tab-panel toggles, since each "tab" is really a
// separate page in this static multi-page app.
export function renderAdminTabs(currentPage) {
  const placeholder = document.getElementById('admin-tabs-placeholder');
  if (!placeholder) return;

  const tab = (page, label) => `<a href="${page}" class="tab-btn${page === currentPage ? ' active' : ''}">${label}</a>`;

  placeholder.innerHTML = `
    <div class="tabs">
      ${tab('session-management.html', 'Session Management')}
      ${tab('access-management.html', 'Access Management')}
    </div>`;
}

export async function renderFooter() {
  const placeholder = document.getElementById('footer-placeholder');
  if (!placeholder) return;

  placeholder.innerHTML = `
    <footer>
      <div class="footer-inner">
        <div class="footer-col footer-brand">
          <a href="index.html" class="footer-logo">
            <img src="/logo.png" alt="" class="footer-logo-img" />
            <span class="footer-logo-text">Smocking <span class="accent-text">Puck</span></span>
          </a>
          <p>Hockey Skills Sessions</p>
        </div>
        <div class="footer-col">
          <p class="footer-heading">Quick Links</p>
          <ul>
            <li><a href="sessions.html">Sessions</a></li>
            <li><a href="my-bookings.html">My Bookings</a></li>
            <li><a href="login.html">Login / Register</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <p class="footer-heading">Contact</p>
          <ul>
            <li><a href="mailto:hello@smockingpuck.com">hello@smockingpuck.com</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <p class="footer-heading">Follow Us</p>
          <ul>
            <li><a href="#">📸 Instagram</a></li>
            <li><a href="#">▶️ YouTube</a></li>
            <li><a href="#">🎵 TikTok</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        &copy; 2026 Smocking Puck. All rights reserved.
      </div>
    </footer>`;
}
