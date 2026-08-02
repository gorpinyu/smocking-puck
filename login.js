import { isLoggedIn, renderNav, renderFooter } from './app.js';

// Attached immediately (not gated behind the async checks below) so an early
// submit is handled by our code, not a native full-page form submission that
// silently drops the data.
document.getElementById('tab-login').addEventListener('click', () => switchTab('login'));
document.getElementById('tab-register').addEventListener('click', () => switchTab('register'));
document.getElementById('goToRegister').addEventListener('click', (e) => { e.preventDefault(); switchTab('register'); });
document.getElementById('goToLogin').addEventListener('click', (e) => { e.preventDefault(); switchTab('login'); });

document.getElementById('loginForm').addEventListener('submit', handleLogin);
document.getElementById('registerForm').addEventListener('submit', handleRegister);
document.getElementById('googleBtn').addEventListener('click', () => { window.location.href = '/api/auth/google'; });

const GOOGLE_ERROR_MESSAGES = {
  google_state_mismatch: 'Google sign-in failed (session expired) — please try again.',
  google_token_exchange: 'Google sign-in failed — please try again.',
  google_email_unverified: 'That Google account\'s email isn\'t verified — please use a verified account or register with email/password.',
  google_unexpected: 'Something went wrong signing in with Google — please try again.',
};

(async () => {
  if (await isLoggedIn()) {
    window.location.href = 'sessions.html';
    return;
  }
  await renderNav();
  await renderFooter();

  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'register') switchTab('register');

  // Set by a failed /api/auth/google redirect (see server/src/routes/auth.js)
  const googleError = params.get('error');
  if (googleError) {
    showError('login-error', GOOGLE_ERROR_MESSAGES[googleError] || 'Google sign-in failed — please try again.');
  }
})();

function switchTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('panel-login').classList.toggle('active', tab === 'login');
  document.getElementById('panel-register').classList.toggle('active', tab === 'register');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
}

function clearError(id) {
  document.getElementById(id).style.display = 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  clearError('login-error');

  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Login failed.');
    window.location.href = 'sessions.html';
  } catch (err) {
    showError('login-error', err.message || 'Login failed.');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  clearError('register-error');

  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Registration failed.');
    // No email-verification step (self-hosted backend) - registering signs
    // you in immediately. TODO before any commercial use: add email
    // verification back (was Cognito's confirm-code step in the AWS version).
    window.location.href = 'sessions.html';
  } catch (err) {
    showError('register-error', err.message || 'Registration failed.');
  }
}
