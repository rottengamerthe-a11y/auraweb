// Load Community Data (from MongoDB via API or data.json fallback)
const FALLBACK_COMMUNITY_DATA = {
  stats: {
    activePlayers: '12,543',
    competitions: '847',
    auraTracked: '15,234,567',
    uptime: '99.8%'
  },
  leaderboard: [
    { rank: 1, name: 'ShadowGrinder', aura: '2,456,789' },
    { rank: 2, name: 'AuraKing', aura: '2,123,456' },
    { rank: 3, name: 'NoLifeHustle', aura: '1,987,654' },
    { rank: 4, name: 'GrindMaster', aura: '1,876,543' },
    { rank: 5, name: 'FarmAlchemist', aura: '1,765,432' }
  ],
  testimonials: [
    {
      text: 'Aurix completely changed how I engage with Discord. The competition is addictive and rewards are amazing!',
      author: 'Player123'
    },
    {
      text: 'Best bot for community engagement. The farming mechanics are so fun and the community is super supportive.',
      author: 'AuraFarmer'
    },
    {
      text: 'Finally a bot that keeps everyone active and motivated. Highly recommend joining the server!',
      author: 'CompetitiveGamer'
    }
  ],
  faqs: [
    {
      question: 'How do I start farming aura?',
      answer: 'Simply use the /farm command in any channel where Aurix is active. The more you interact, the more aura you accumulate!'
    },
    {
      question: 'Can I use Aurix on my own server?',
      answer: 'Yes! Click the Add Bot to Your Server button and authorize Aurix. You\'ll have full access to all features.'
    },
    {
      question: 'What are the rewards for ranking up?',
      answer: 'Higher ranks unlock exclusive roles, badges, bonus aura multipliers, and access to premium competitions.'
    },
    {
      question: 'How often does the leaderboard reset?',
      answer: 'The global leaderboard resets monthly, while seasonal leaderboards reset quarterly. Your stats are always preserved!'
    },
    {
      question: 'Is Aurix free to use?',
      answer: 'Yes, Aurix has free core features. Premium plans add stronger boosts and bonus rewards for players who want to progress faster.'
    },
    {
      question: 'How can I report bugs or suggest features?',
      answer: 'Join our official Discord server and use the #suggestions and #bug-reports channels. We read and respond to all feedback!'
    }
  ]
};

let communityData = {};
const DISCORD_AUTH_STORAGE_KEY = 'aurixDiscordAuth';
const PENDING_CHECKOUT_STORAGE_KEY = 'aurixPendingCheckout';
const DASHBOARD_TOKEN_STORAGE_KEY = 'aurixDashboardToken';
let discordUser = null;

function getDiscordUser() {
  if (discordUser) {
    return discordUser;
  }

  const auth = getStoredDiscordAuth();
  return auth ? auth.user : null;
}

function getStoredDiscordAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(DISCORD_AUTH_STORAGE_KEY) || 'null');

    if (!auth || !auth.user || !auth.expiresAt || Date.now() >= auth.expiresAt) {
      localStorage.removeItem(DISCORD_AUTH_STORAGE_KEY);
      return null;
    }

    return auth;
  } catch (error) {
    localStorage.removeItem(DISCORD_AUTH_STORAGE_KEY);
    return null;
  }
}

function buildDiscordLoginUrl() {
  const authBaseUrl = window.AUTH_BASE_URL || window.location.origin;
  const returnTo = `${window.location.origin}${window.location.pathname}`;
  return `${authBaseUrl}/auth/discord?return_to=${encodeURIComponent(returnTo)}`;
}

function beginDiscordLogin() {
  if (window.location.protocol === 'file:') {
    alert('Discord login needs a real website URL. Run the site with python -m http.server 8000 --bind 127.0.0.1, then open http://127.0.0.1:8000/.');
    return;
  }

  window.location.href = buildDiscordLoginUrl();
}

async function logoutDiscord() {
  const authBaseUrl = window.AUTH_BASE_URL || window.location.origin;
  const dashboardToken = localStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY);

  try {
    await fetch(`${authBaseUrl}/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: dashboardToken ? { Authorization: `Bearer ${dashboardToken}` } : {}
    });
  } catch (error) {
    console.warn('Logout request failed:', error);
  }

  discordUser = null;
  localStorage.removeItem(DISCORD_AUTH_STORAGE_KEY);
  localStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
  updateDiscordLoginUI();
}

function requireDiscordLogin(priceId, planId) {
  if (getDiscordUser()) {
    return true;
  }

  if (priceId) {
    sessionStorage.setItem(PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify({ priceId, planId }));
  }

  beginDiscordLogin();
  return false;
}

function resumePendingCheckout(attempt = 0) {
  const pendingCheckout = getPendingCheckout();

  if (!pendingCheckout || !getDiscordUser()) {
    return;
  }

  if (typeof openCheckout === 'function' && window.paddleReady === true && typeof Paddle !== 'undefined') {
    sessionStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
    openCheckout(pendingCheckout.priceId, pendingCheckout.planId);
    return;
  }

  if (attempt < 20) {
    setTimeout(() => resumePendingCheckout(attempt + 1), 300);
  }
}

function getPendingCheckout() {
  try {
    const pendingCheckout = JSON.parse(sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY) || 'null');
    return pendingCheckout && pendingCheckout.priceId ? pendingCheckout : null;
  } catch (error) {
    sessionStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
    return null;
  }
}

async function refreshDiscordSession() {
  const query = new URLSearchParams(window.location.search);
  const redirectedUser = query.get('discord_user');
  const dashboardToken = query.get('dashboard_token');

  if (query.get('discord_login') === '1' && redirectedUser) {
    try {
      discordUser = JSON.parse(redirectedUser);
      localStorage.setItem(DISCORD_AUTH_STORAGE_KEY, JSON.stringify({
        user: discordUser,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      }));
      if (dashboardToken) {
        localStorage.setItem(DASHBOARD_TOKEN_STORAGE_KEY, dashboardToken);
      }
      history.replaceState(null, document.title, window.location.pathname);
      updateDiscordLoginUI();

      if (discordUser && sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)) {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
        resumePendingCheckout();
      }
      return;
    } catch (error) {
      console.warn('Could not restore Discord login from callback:', error);
    }
  }

  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get('access_token');
  const expiresIn = Number(hash.get('expires_in') || 0);

  if (accessToken) {
    try {
      const user = await fetchDiscordUser(accessToken);
      discordUser = user;
      localStorage.setItem(DISCORD_AUTH_STORAGE_KEY, JSON.stringify({
        accessToken,
        user,
        expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000
      }));
      history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    } catch (error) {
      console.error('Discord login error:', error);
      alert('Discord login failed. Please try again.');
    } finally {
      updateDiscordLoginUI();

      if (discordUser && sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)) {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
        resumePendingCheckout();
      }
    }
    return;
  }

  const storedAuth = getStoredDiscordAuth();
  if (storedAuth) {
    discordUser = storedAuth.user;
    updateDiscordLoginUI();
    return;
  }

  const authBaseUrl = window.AUTH_BASE_URL || window.location.origin;

  try {
    const response = await fetch(`${authBaseUrl}/api/me`, { credentials: 'include' });
    if (response.ok) {
      const payload = await response.json();
      discordUser = payload.user || null;
    } else {
      discordUser = null;
    }
  } catch (error) {
    console.warn('Could not refresh Discord session:', error);
    discordUser = null;
  } finally {
    updateDiscordLoginUI();

    if (discordUser && sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)) {
      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
      resumePendingCheckout();
    }
  }
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Discord profile request failed.');
  }

  return response.json();
}

function updateDiscordLoginUI() {
  const loginButton = document.getElementById('discordLoginButton');
  const pricingLoginNote = document.getElementById('pricingLoginNote');
  const user = getDiscordUser();

  if (loginButton) {
    if (user) {
      loginButton.textContent = `Logged in as ${user.global_name || user.username}`;
      loginButton.classList.add('is-logged-in');
      loginButton.title = 'Click to log out';
      loginButton.onclick = logoutDiscord;
    } else {
      loginButton.textContent = 'Login with Discord';
      loginButton.classList.remove('is-logged-in');
      loginButton.title = 'Login is required before buying a membership';
      loginButton.onclick = beginDiscordLogin;
    }
  }

  if (pricingLoginNote) {
    pricingLoginNote.textContent = user
      ? `Memberships will be linked to ${user.global_name || user.username}.`
      : 'Login with Discord before buying so your membership can be linked to your account.';
  }
}

async function loadData() {
  try {
    // Try to load from MongoDB API first
    if (typeof API_ENDPOINT !== 'undefined' && API_ENDPOINT && API_ENDPOINT !== 'https://your-bot-name.onrender.com/api/community-data') {
      console.log('Fetching from MongoDB API:', API_ENDPOINT);
      try {
        const response = await fetch(API_ENDPOINT);
        if (response.ok) {
          communityData = await response.json();
          console.log('✅ Data loaded from API');
          updateUI();
          return;
        }
      } catch (apiError) {
        console.warn('API fetch failed, trying fallback:', apiError.message);
      }
    }
    
    // Fallback to data.json
    console.log('Loading from data.json fallback...');
    try {
      const response = await fetch('data.json');
      if (response.ok) {
        communityData = await response.json();
        console.log('✅ Data loaded from data.json');
        updateUI();
        return;
      }
    } catch (fetchError) {
      console.warn('Could not fetch data.json locally:', fetchError.message);
    }

    // Use inline fallback if data.json cannot be loaded from file://
    communityData = FALLBACK_COMMUNITY_DATA;
    console.log('✅ Data loaded from inline fallback');
    updateUI();
  } catch (error) {
    console.error('❌ Error loading data:', error);
  }
}

function updateUI() {
  updateStats();
  updateLeaderboard();
  updateTestimonials();
  updateFAQ();
}

function updateStats() {
  if (!communityData.stats) return;
  
  const statCards = document.querySelectorAll('.stat-card');
  const stats = [
    { number: communityData.stats.activePlayers, label: 'Active Players' },
    { number: communityData.stats.competitions, label: 'Competitions' },
    { number: communityData.stats.auraTracked, label: 'Aura Tracked' },
    { number: communityData.stats.uptime, label: 'Uptime' }
  ];
  
  statCards.forEach((card, index) => {
    if (stats[index]) {
      card.querySelector('.stat-number').textContent = stats[index].number;
      card.querySelector('.stat-label').textContent = stats[index].label;
    }
  });
}

function updateLeaderboard() {
  if (!communityData.leaderboard) return;
  
  const leaderboard = document.querySelector('.leaderboard');
  if (!leaderboard) return;
  leaderboard.innerHTML = '';
  
  communityData.leaderboard.forEach(player => {
    const item = document.createElement('div');
    item.className = 'leaderboard-item';
    item.innerHTML = `
      <span class="rank">${player.rank}</span>
      <span class="player-name">${player.name}</span>
      <span class="aura-count">${player.aura} ✨</span>
    `;
    leaderboard.appendChild(item);
  });
}

function updateTestimonials() {
  if (!communityData.testimonials) return;
  
  const testimonialsGrid = document.querySelector('.testimonials-grid');
  if (!testimonialsGrid) return;
  testimonialsGrid.innerHTML = '';
  
  communityData.testimonials.forEach(testimonial => {
    const card = document.createElement('div');
    card.className = 'testimonial-card';
    card.innerHTML = `
      <p>"${testimonial.text}"</p>
      <span class="testimonial-author">- ${testimonial.author}</span>
    `;
    testimonialsGrid.appendChild(card);
  });
}

function updateFAQ() {
  if (!communityData.faqs) return;
  
  const faqItems = document.querySelector('.faq-items');
  if (!faqItems) return;
  faqItems.innerHTML = '';
  
  communityData.faqs.forEach(faq => {
    const item = document.createElement('div');
    item.className = 'faq-item';
    item.innerHTML = `
      <h3>${faq.question}</h3>
      <p>${faq.answer}</p>
    `;
    faqItems.appendChild(item);
  });
}

// Load data on page load
document.addEventListener('DOMContentLoaded', loadData);
document.addEventListener('DOMContentLoaded', () => {
  updateDiscordLoginUI();
  refreshDiscordSession();
  initRoleDashboard();
});

async function dashboardFetch(path, options = {}) {
  const authBaseUrl = window.AUTH_BASE_URL || window.location.origin;
  const dashboardToken = localStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY);
  const response = await fetch(`${authBaseUrl}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(dashboardToken ? { Authorization: `Bearer ${dashboardToken}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Dashboard request failed.');
  }
  return payload;
}

function setDashboardStatus(message, isError = false) {
  const status = document.getElementById('roleDashboardStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function renderGuildOptions(guilds) {
  const select = document.getElementById('dashboardGuildSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Choose a server</option>';
  guilds.forEach((guild) => {
    const option = document.createElement('option');
    option.value = guild.id;
    option.textContent = guild.name;
    select.appendChild(option);
  });
}

function renderRoleOptions(roles) {
  const select = document.getElementById('dashboardRoleSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Choose a role</option>';
  roles.forEach((role) => {
    const option = document.createElement('option');
    option.value = role.id;
    option.textContent = role.name;
    select.appendChild(option);
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function renderRoleListings(listings) {
  const list = document.getElementById('roleListingList');
  if (!list) return;
  list.innerHTML = '';

  if (!listings.length) {
    list.innerHTML = '<p class="dashboard-empty">No roles listed yet.</p>';
    return;
  }

  listings.forEach((listing) => {
    const item = document.createElement('div');
    item.className = 'role-listing-item';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(listing.name)}</strong>
        <span>${Number(listing.price).toLocaleString()} aura</span>
        <small>${escapeHtml(listing.description || 'No description')} | ${listing.enabled ? 'Enabled' : 'Disabled'} | ${listing.purchaseCount || 0} purchases</small>
        <code>${escapeHtml(listing.id)}</code>
      </div>
      <button type="button" data-listing-id="${listing.id}" data-enabled="${listing.enabled ? 'false' : 'true'}">${listing.enabled ? 'Disable' : 'Enable'}</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('button[data-listing-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await dashboardFetch(`/api/dashboard/role-listings/${button.dataset.listingId}/toggle`, {
          method: 'POST',
          body: JSON.stringify({ enabled: button.dataset.enabled === 'true' })
        });
        await loadRoleListings();
      } catch (error) {
        setDashboardStatus(error.message, true);
      }
    });
  });
}

async function loadRoleListings() {
  const guildId = document.getElementById('dashboardGuildSelect')?.value;
  if (!guildId) {
    renderRoleListings([]);
    return;
  }

  const payload = await dashboardFetch(`/api/dashboard/guilds/${guildId}/role-listings`);
  renderRoleListings(payload.listings || []);
}

async function loadDashboardGuildData(guildId) {
  if (!guildId) {
    renderRoleOptions([]);
    renderRoleListings([]);
    return;
  }

  setDashboardStatus('Loading server roles...');
  const rolesPayload = await dashboardFetch(`/api/dashboard/guilds/${guildId}/roles`);
  renderRoleOptions(rolesPayload.roles || []);
  await loadRoleListings();
  setDashboardStatus('Ready. Create a listing or update an existing role.');
}

async function initRoleDashboard() {
  const dashboard = document.getElementById('roleDashboard');
  if (!dashboard) return;

  const loginButton = document.getElementById('dashboardLoginButton');
  const guildSelect = document.getElementById('dashboardGuildSelect');
  const form = document.getElementById('roleListingForm');

  loginButton?.addEventListener('click', beginDiscordLogin);
  guildSelect?.addEventListener('change', () => {
    loadDashboardGuildData(guildSelect.value).catch((error) => setDashboardStatus(error.message, true));
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const guildId = guildSelect?.value;
    const roleId = document.getElementById('dashboardRoleSelect')?.value;
    const price = Number(document.getElementById('roleListingPrice')?.value || 0);
    const description = document.getElementById('roleListingDescription')?.value || '';
    const enabled = document.getElementById('roleListingEnabled')?.checked ?? true;

    if (!guildId || !roleId) {
      setDashboardStatus('Choose a server and role first.', true);
      return;
    }

    try {
      await dashboardFetch(`/api/dashboard/guilds/${guildId}/role-listings`, {
        method: 'POST',
        body: JSON.stringify({ roleId, price, description, enabled })
      });
      form.reset();
      guildSelect.value = guildId;
      document.getElementById('roleListingEnabled').checked = true;
      await loadDashboardGuildData(guildId);
      setDashboardStatus('Role listing saved.');
    } catch (error) {
      setDashboardStatus(error.message, true);
    }
  });

  try {
    const payload = await dashboardFetch('/api/dashboard/guilds');
    const guilds = payload.guilds || [];
    renderGuildOptions(guilds);
    setDashboardStatus(guilds.length ? 'Choose a server you manage.' : 'No manageable servers found for this Discord account.');
  } catch (error) {
    setDashboardStatus('Login with Discord to manage server role listings.');
  }
}

// Mobile Navigation Toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');

if (navToggle) {
  navToggle.addEventListener('click', function() {
    navMenu.classList.toggle('active');
  });

  // Close menu when a link is clicked
  document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', function() {
      navMenu.classList.remove('active');
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', function(event) {
    if (!event.target.closest('.sticky-nav')) {
      navMenu.classList.remove('active');
    }
  });
}

// Newsletter Form Handler
const newsletterForm = document.getElementById('newsletterForm');

if (newsletterForm) {
  newsletterForm.addEventListener('submit', function(e) {
    e.preventDefault();
    
    const email = this.querySelector('input[type="email"]').value;
    const button = this.querySelector('button');
    
    // Simulate submission
    button.textContent = 'Subscribed! ✓';
    button.style.opacity = '0.8';
    
    setTimeout(() => {
      this.reset();
      button.textContent = 'Subscribe';
      button.style.opacity = '1';
    }, 3000);
  });
}

// Scroll animations trigger
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -100px 0px'
};

const observer = new IntersectionObserver(function(entries) {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
    }
  });
}, observerOptions);

document.querySelectorAll('main section').forEach(section => {
  observer.observe(section);
});
