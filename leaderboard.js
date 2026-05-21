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

const leaderboardState = {
  page: 1,
  limit: 10,
  query: '',
  totalPlayers: 0,
  totalPages: 1
};

function updatePagination(payload) {
  const pageLabel = document.getElementById('leaderboardPageLabel');
  const prevButton = document.getElementById('leaderboardPrevButton');
  const nextButton = document.getElementById('leaderboardNextButton');
  const page = Number(payload.page || leaderboardState.page || 1);
  const limit = Number(payload.limit || leaderboardState.limit || 10);
  const totalPlayers = Number(payload.totalPlayers || 0);
  const totalPages = Math.max(1, Math.ceil(totalPlayers / limit));

  leaderboardState.page = page;
  leaderboardState.limit = limit;
  leaderboardState.totalPlayers = totalPlayers;
  leaderboardState.totalPages = totalPages;

  if (pageLabel) pageLabel.textContent = `Page ${page} of ${totalPages}`;
  if (prevButton) prevButton.disabled = page <= 1;
  if (nextButton) nextButton.disabled = page >= totalPages;
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
  playerCount.textContent = payload.totalPlayersLabel || payload.totalPlayers || '0';
  auraTotal.textContent = payload.auraTracked || '0';
  updated.textContent = formatUpdatedAt(payload.updatedAt);

  list.innerHTML = '';
  const players = Array.isArray(payload.players) ? payload.players : [];
  if (!players.length) {
    const empty = document.createElement('div');
    empty.className = 'public-leaderboard-empty';
    empty.textContent = 'No ranked players found for this leaderboard yet.';
    list.appendChild(empty);
    updatePagination(payload);
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

  updatePagination(payload);
}

async function loadLeaderboard() {
  const slug = encodeURIComponent(getLeaderboardSlug());
  const params = new URLSearchParams({
    page: String(leaderboardState.page),
    limit: String(leaderboardState.limit)
  });
  if (leaderboardState.query) params.set('q', leaderboardState.query);
  const endpoint = `${getAuthBaseUrl()}/api/leaderboards/${slug}?${params.toString()}`;
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Leaderboard API returned HTTP ${response.status}`);
  }
  renderLeaderboard(await response.json());
}

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('leaderboardSearchInput');
  const prevButton = document.getElementById('leaderboardPrevButton');
  const nextButton = document.getElementById('leaderboardNextButton');
  let searchTimer;

  searchInput?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      leaderboardState.query = searchInput.value.trim();
      leaderboardState.page = 1;
      loadLeaderboard().catch(console.warn);
    }, 220);
  });

  prevButton?.addEventListener('click', () => {
    if (leaderboardState.page <= 1) return;
    leaderboardState.page -= 1;
    loadLeaderboard().catch(console.warn);
  });

  nextButton?.addEventListener('click', () => {
    if (leaderboardState.page >= leaderboardState.totalPages) return;
    leaderboardState.page += 1;
    loadLeaderboard().catch(console.warn);
  });

  loadLeaderboard().catch((error) => {
    console.warn(error);
    const list = document.getElementById('publicLeaderboardList');
    if (list) {
      list.innerHTML = '<div class="public-leaderboard-empty">Leaderboard is unavailable right now.</div>';
    }
  });
  window.setInterval(() => loadLeaderboard().catch(console.warn), 60000);
});
