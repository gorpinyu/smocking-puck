import { Amplify } from 'aws-amplify';
import {
  getCurrentUser as amplifyGetCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import { Hub } from 'aws-amplify/utils';
import outputs from './amplify_outputs.json';

Amplify.configure(outputs);
console.debug('app.js: Amplify configured, module loaded');

export const client = generateClient();

let cachedUser; // memoized per page load — avoids re-fetching attributes on every call

// signInWithRedirect (Google) completes asynchronously after the browser
// lands back on the app - the page's own render logic (nav AND main
// content) may already have run against the pre-redirect (guest) session.
// A one-time reload re-runs everything against the now-established session.
// Reload to the bare path (no query string) rather than location.reload() -
// the ?code=&state= from the OAuth redirect may still be in the URL at this
// point, and reloading with it still attached makes Amplify try to exchange
// that single-use code a second time, which fails and leaves the page stuck
// looking logged-out (silently, since getCurrentUser()'s catch swallows it).
Hub.listen('auth', ({ payload }) => {
  console.debug('Hub auth event:', payload.event);
  if (payload.event === 'signInWithRedirect') {
    window.location.replace(window.location.pathname);
  } else if (payload.event === 'signInWithRedirect_failure') {
    // Logged (not just swallowed) so a failed OAuth code exchange is
    // diagnosable instead of silently leaving the page looking logged-out.
    console.error('Google sign-in redirect failed:', payload.data);
  }
});

export async function getCurrentUser() {
  if (cachedUser !== undefined) return cachedUser;
  console.debug('getCurrentUser: start');
  try {
    console.debug('getCurrentUser: calling amplifyGetCurrentUser()');
    await amplifyGetCurrentUser();
    console.debug('getCurrentUser: amplifyGetCurrentUser() resolved, calling fetchUserAttributes()');
    const attrs = await fetchUserAttributes();
    console.debug('getCurrentUser: fetchUserAttributes() resolved', attrs);
    cachedUser = { id: attrs.sub, name: attrs.name || attrs.email, email: attrs.email };
  } catch (err) {
    // Logged at debug level: "no current user" is the expected/common case
    // for guests, but keeping the real error visible (instead of a bare
    // catch) is what actually let us diagnose the redirect failure below.
    console.debug('getCurrentUser: no authenticated user', err);
    cachedUser = null;
  }
  return cachedUser;
}

export async function isLoggedIn() {
  return !!(await getCurrentUser());
}

export async function isAdmin() {
  try {
    const session = await fetchAuthSession();
    const groups = session.tokens?.accessToken?.payload['cognito:groups'] || [];
    return groups.includes('Admins');
  } catch {
    return false;
  }
}

export async function logout() {
  await amplifySignOut();
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

export const formatDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
};

// Session mode is derived from capacity, not stored: 1 spot = 1-on-1, 2 = 1-on-2.
export const sessionMode = (maxCapacity) => (maxCapacity >= 2 ? '1-on-2' : '1-on-1');

export const formatTime = (timeStr) => {
  const [h, min] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(min).padStart(2, '0')} ${ampm}`;
};

export async function renderNav() {
  console.debug('renderNav: start');
  const placeholder = document.getElementById('nav-placeholder');
  if (!placeholder) return;

  const user = await getCurrentUser();
  console.debug('renderNav: getCurrentUser() resolved', user);
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const active = (p) => (page === p ? ' class="active"' : '');
  const firstName = user ? escapeHtml(user.name.split(' ')[0]) : '';

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
        <a href="index.html" class="nav-logo">🏒 Smocking Puck</a>
        <ul class="nav-links">
          <li><a href="sessions.html"${active('sessions.html')}>Sessions</a></li>
          <li><a href="my-bookings.html"${active('my-bookings.html')}>My Bookings</a></li>
          <li><a href="players.html"${active('players.html')}>My Players</a></li>
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
        ${mobileAuth}
      </div>
    </nav>`;

  document.getElementById('hamburgerBtn').addEventListener('click', () => {
    document.getElementById('mobileMenu').classList.toggle('open');
  });
  document.querySelectorAll('[data-action="logout"]').forEach((btn) => {
    btn.addEventListener('click', logout);
  });
}

export async function renderFooter() {
  const placeholder = document.getElementById('footer-placeholder');
  if (!placeholder) return;

  placeholder.innerHTML = `
    <footer>
      <div class="footer-inner">
        <div class="footer-col footer-brand">
          <a href="index.html" class="footer-logo">🏒 Smocking Puck</a>
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
