import { isLoggedIn, renderNav } from './app.js';
import { signUp, confirmSignUp, resendSignUpCode, signIn, signInWithRedirect } from 'aws-amplify/auth';

let pendingEmail = null;
let pendingPassword = null;

(async () => {
  if (await isLoggedIn()) {
    window.location.href = 'sessions.html';
    return;
  }
  await renderNav();

  if (new URLSearchParams(window.location.search).get('tab') === 'register') switchTab('register');

  document.getElementById('tab-login').addEventListener('click', () => switchTab('login'));
  document.getElementById('tab-register').addEventListener('click', () => switchTab('register'));
  document.getElementById('goToRegister').addEventListener('click', (e) => { e.preventDefault(); switchTab('register'); });
  document.getElementById('goToLogin').addEventListener('click', (e) => { e.preventDefault(); switchTab('login'); });

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('registerForm').addEventListener('submit', handleRegister);
  document.getElementById('verifyForm').addEventListener('submit', handleVerify);
  document.getElementById('resendCode').addEventListener('click', handleResend);
  document.getElementById('googleBtn').addEventListener('click', () => signInWithRedirect({ provider: 'Google' }));
})();

function switchTab(tab) {
  document.getElementById('tabs').style.display = tab === 'verify' ? 'none' : '';
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('panel-login').classList.toggle('active', tab === 'login');
  document.getElementById('panel-register').classList.toggle('active', tab === 'register');
  document.getElementById('panel-verify').classList.toggle('active', tab === 'verify');
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
    await signIn({ username: email, password });
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
    const { nextStep } = await signUp({
      username: email,
      password,
      options: { userAttributes: { email, name } },
    });

    if (nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
      pendingEmail = email;
      pendingPassword = password;
      document.getElementById('verifyEmailLabel').textContent = email;
      switchTab('verify');
    } else {
      window.location.href = 'sessions.html';
    }
  } catch (err) {
    showError('register-error', err.message || 'Registration failed.');
  }
}

async function handleVerify(e) {
  e.preventDefault();
  clearError('verify-error');
  const code = document.getElementById('verifyCode').value.trim();

  try {
    await confirmSignUp({ username: pendingEmail, confirmationCode: code });
    await signIn({ username: pendingEmail, password: pendingPassword });
    window.location.href = 'sessions.html';
  } catch (err) {
    showError('verify-error', err.message || 'Verification failed.');
  }
}

async function handleResend(e) {
  e.preventDefault();
  clearError('verify-error');
  try {
    await resendSignUpCode({ username: pendingEmail });
  } catch (err) {
    showError('verify-error', err.message || 'Could not resend code.');
  }
}
