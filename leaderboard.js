function getAuthBaseUrl() {
  return window.AUTH_BASE_URL || window.location.origin;
}

function getLeaderboardSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] || 'global';
}

function formatUpdatedAt(value) {
  if (!value) return 'Live';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Live';
  return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function renderLeaderboard(payload) {
  const title = document.getElementById('leaderboardTitle');
  const subtitle = document.getElementById('leaderboardSubtitle');
  const playerCount = document.getElementById('leaderboardPlayerCount');
  const auraTotal = document.getElementById('leaderboardAuraTotal');
  const updated = document.getElementById('leaderboardUpdated');
  const list = document.getElementById('publicLeaderboardList');

  title.textContent = payload.title || 'Public Rankings';
  subtitle.textContent = payload.slug === 'global'
    ? 'Live global aura standings across Aurix players.'
    : 'Live aura standings for this Aurix server.';
  playerCount.textContent = payload.totalPlayers || '0';
  auraTotal.textContent = payload.auraTracked || '0';
  updated.textContent = formatUpdatedAt(payload.updatedAt);

  list.innerHTML = '';
  const players = Array.isArray(payload.players) ? payload.players : [];
  if (!players.length) {
    const empty = document.createElement('div');
    empty.className = 'public-leaderboard-empty';
    empty.textContent = 'No ranked players found for this leaderboard yet.';
    list.appendChild(empty);
    return;
  }

  players.forEach((player) => {
    const row = document.createElement('article');
    const rank = document.createElement('strong');
    const name = document.createElement('span');
    const aura = document.createElement('em');

    row.className = 'public-leaderboard-row';
    rank.textContent = `#${player.rank}`;
    name.textContent = player.name;
    aura.textContent = `${player.aura} aura`;

    row.append(rank, name, aura);
    list.appendChild(row);
  });
}

async function loadLeaderboard() {
  const slug = encodeURIComponent(getLeaderboardSlug());
  const endpoint = `${getAuthBaseUrl()}/api/leaderboards/${slug}`;
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Leaderboard API returned HTTP ${response.status}`);
  }
  renderLeaderboard(await response.json());
}

document.addEventListener('DOMContentLoaded', () => {
  loadLeaderboard().catch((error) => {
    console.warn(error);
    const list = document.getElementById('publicLeaderboardList');
    if (list) {
      list.innerHTML = '<div class="public-leaderboard-empty">Leaderboard is unavailable right now.</div>';
    }
  });
  window.setInterval(() => loadLeaderboard().catch(console.warn), 60000);
});
