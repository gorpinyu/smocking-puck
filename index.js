import { client, getCurrentUser, escapeHtml, formatDate, formatTime, isPastDate, sessionMode, renderNav, renderFooter } from './app.js';

renderNav();
renderFooter();
renderNextUp();

async function renderNextUp() {
  const user = await getCurrentUser();
  const grid = document.getElementById('nextUpGrid');
  const empty = document.getElementById('nextUpEmpty');

  // Guest browsing temporarily disabled as a diagnostic test for the Google
  // sign-in hang - see rollback branch "pre-disable-guest-browsing".
  if (!user) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  const { data: sessions } = await client.models.Session.list();

  const upcoming = sessions
    .filter((s) => !isPastDate(s.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 3);

  if (upcoming.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.innerHTML = upcoming.map((s, i) => buildPreviewCard(s, i)).join('');
}

function buildPreviewCard(s, i) {
  const spotsLeft = s.maxCapacity - s.bookedCount;
  const isFull = spotsLeft <= 0;

  return `
    <div class="card session-card animate-in" style="animation-delay:${i * 0.07}s">
      <div class="session-card-top">
        <span class="session-date">${formatDate(s.date)}</span>
        <span class="mode-badge">${sessionMode(s.maxCapacity)}</span>
      </div>
      <h3>${escapeHtml(s.title)}</h3>
      <div class="session-meta">
        <span>⏰ ${formatTime(s.time)}</span>
        <span>⏱ ${s.duration} min session</span>
      </div>
      <div class="session-footer">
        <span class="spots${isFull ? ' full' : ''}">
          ${isFull ? 'Full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
        </span>
        <a href="sessions.html" class="btn btn-primary btn-sm">View &amp; Book →</a>
      </div>
    </div>`;
}
