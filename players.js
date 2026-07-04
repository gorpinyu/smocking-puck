import { client, isLoggedIn, escapeHtml, renderNav, renderFooter } from './app.js';

// Attached immediately (not gated behind the async login check below) so a
// submit before that check resolves is handled by our code, not a native
// full-page form submission that silently drops the data.
document.getElementById('addPlayerForm').addEventListener('submit', addPlayer);

(async () => {
  if (!(await isLoggedIn())) {
    window.location.href = 'login.html';
    return;
  }
  await renderNav();
  await renderFooter();
  await renderPlayers();
})();

async function renderPlayers() {
  const { data: rawPlayers } = await client.models.Player.list();
  // Same AppSync null-item behavior as Session.list() elsewhere (a legacy
  // row missing a since-added required field) - drop it instead of letting
  // the sort below crash on a null entry.
  const players = rawPlayers.filter(Boolean);
  players.sort((a, b) => a.name.localeCompare(b.name));

  const list = document.getElementById('playersList');
  const empty = document.getElementById('emptyState');

  if (players.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  list.style.display = 'flex';
  empty.style.display = 'none';
  list.innerHTML = players.map((p) => `
    <div class="card booking-card">
      <div class="booking-info">
        <h3>👤 ${escapeHtml(p.name)}</h3>
      </div>
      <button class="btn btn-danger btn-sm" data-action="remove" data-id="${p.id}">Remove</button>
    </div>`).join('');

  list.querySelectorAll('[data-action="remove"]').forEach((btn) => {
    btn.addEventListener('click', () => removePlayer(btn.dataset.id));
  });
}

async function addPlayer(e) {
  e.preventDefault();
  const input = document.getElementById('playerName');
  const name = input.value.trim();
  if (!name) return;
  await client.models.Player.create({ name });
  input.value = '';
  await renderPlayers();
}

async function removePlayer(id) {
  if (!confirm('Remove this player? Existing bookings are not affected.')) return;
  await client.models.Player.delete({ id });
  await renderPlayers();
}
