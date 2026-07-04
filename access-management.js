import { client, isAdmin, getCurrentUsername, escapeHtml, renderNav, renderFooter, renderAdminTabs } from './app.js';

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
  renderAdminTabs('access-management.html');

  await renderUsers();
})();

async function renderUsers() {
  const errEl = document.getElementById('usersError');
  errEl.style.display = 'none';
  const wrap = document.getElementById('usersTableWrap');

  const myUsername = await getCurrentUsername();

  // listAppUsers/setAdminRole are Lambda-backed (amplify/functions/manage-users)
  // custom operations, not model CRUD - same {data, errors} resolution as
  // every other Amplify Data call (doesn't throw on failure).
  const { data, errors } = await client.queries.listAppUsers();
  if (errors?.length) {
    errEl.textContent = errors[0].message || 'Failed to load users.';
    errEl.style.display = 'block';
    return;
  }

  const users = (data || []).filter(Boolean)
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

  if (users.length === 0) {
    wrap.innerHTML = '<p style="color:#999;font-size:.9rem">No users found.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        ${users.map((u) => {
          const isSelf = myUsername && u.username === myUsername;
          const statusBadge = u.isAdmin
            ? '<span class="badge badge-booked">Admin</span>'
            : '<span style="color:#bbb">—</span>';
          const action = isSelf
            ? '<span style="color:#bbb;font-size:.85rem">You</span>'
            : u.isAdmin
              ? `<button class="btn btn-danger btn-sm" data-action="revoke-admin" data-username="${escapeHtml(u.username)}" data-name="${escapeHtml(u.name || u.email)}">Revoke Admin</button>`
              : `<button class="btn btn-primary btn-sm" data-action="grant-admin" data-username="${escapeHtml(u.username)}" data-name="${escapeHtml(u.name || u.email)}">Grant Admin</button>`;

          return `<tr>
            <td>${escapeHtml(u.name || '—')}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${statusBadge}</td>
            <td class="admin-actions">${action}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('[data-action="grant-admin"]').forEach((btn) => {
    btn.addEventListener('click', () => setAdminRole(btn.dataset.username, true, btn.dataset.name));
  });
  wrap.querySelectorAll('[data-action="revoke-admin"]').forEach((btn) => {
    btn.addEventListener('click', () => setAdminRole(btn.dataset.username, false, btn.dataset.name));
  });
}

async function setAdminRole(username, makeAdmin, name) {
  if (makeAdmin) {
    if (!confirm(`Grant Admin access to ${name}?`)) return;
  } else {
    if (!confirm(`Revoke Admin access from ${name}? They'll lose access to Session Management and Access Management.`)) return;
  }

  const errEl = document.getElementById('usersError');
  errEl.style.display = 'none';

  const { errors } = await client.mutations.setAdminRole({ username, makeAdmin });
  if (errors?.length) {
    errEl.textContent = errors[0].message || 'Failed to update admin access.';
    errEl.style.display = 'block';
    return;
  }

  // The affected user's own currently-issued token (if signed in right now)
  // won't reflect this until it refreshes or they sign in again - not a bug
  // if their access doesn't change immediately.
  await renderUsers();
}
