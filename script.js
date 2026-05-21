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
const DASHBOARD_API = {
  guilds: '/api/dashboard/guilds',
  guildRoles: (guildId) => `/api/dashboard/guilds/${guildId}/roles`,
  roleListings: (guildId) => `/api/dashboard/guilds/${guildId}/role-listings`,
  toggleRoleListing: (listingId) => `/api/dashboard/role-listings/${listingId}/toggle`,
  roleListing: (listingId) => `/api/dashboard/role-listings/${listingId}`
};
const PREMIUM_PLAN_CONTENT = {
  monthly: {
    title: 'Premium Monthly',
    price: '$4.99',
    term: '/month',
    badge: 'Flexible monthly access',
    anchor: 'Start premium without a long-term commitment.',
    button: 'Get Monthly',
    planId: 'monthly',
    getPriceId: () => monthlyPriceId,
    benefits: [
      '1.33x faster command pace from shorter cooldowns',
      '1.35x bot progression from spin, work, and mining commands',
      '1.60x daily bot progression and XP',
      'Premium Chest every 16 hours',
      'Welcome bundle: 6,000 aura, rare crates, and 1 epic crate',
      'Premium shop items, cosmetics, reminders, and profile status'
    ]
  },
  yearly: {
    title: 'Premium Annual',
    price: '$19.99',
    term: '/year',
    badge: 'Best value - save $39.89/year',
    anchor: 'About four months of monthly pricing.',
    button: 'Get Annual - Save 66%',
    planId: 'yearly',
    getPriceId: () => yearlyPriceId,
    benefits: [
      '1.54x faster command pace from shorter cooldowns',
      '1.55x bot progression from spin, work, and mining commands',
      '2x daily bot progression and XP',
      'Premium Chest every 12 hours',
      'Welcome bundle: 18,000 aura, rare crates, epic crates, and 1 legendary crate',
      'Premium shop items, cosmetics, reminders, and profile status'
    ]
  }
};
let discordUser = null;
const appState = {
  auth: {
    user: null,
    dashboardToken: null
  }
};

function getAuthBaseUrl() {
  return window.AUTH_BASE_URL || window.location.origin;
}

function setDiscordUser(user) {
  discordUser = user || null;
  appState.auth.user = discordUser;
  appState.auth.dashboardToken = localStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY);
  updateDiscordLoginUI();
}

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
      localStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
      return null;
    }

    return auth;
  } catch (error) {
    localStorage.removeItem(DISCORD_AUTH_STORAGE_KEY);
    localStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
    return null;
  }
}

function buildDiscordLoginUrl() {
  const authBaseUrl = getAuthBaseUrl();
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
  const authBaseUrl = getAuthBaseUrl();
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

  localStorage.removeItem(DISCORD_AUTH_STORAGE_KEY);
  localStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
  setDiscordUser(null);
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
      const user = JSON.parse(redirectedUser);
      localStorage.setItem(DISCORD_AUTH_STORAGE_KEY, JSON.stringify({
        user,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      }));
      if (dashboardToken) {
        localStorage.setItem(DASHBOARD_TOKEN_STORAGE_KEY, dashboardToken);
      }
      history.replaceState(null, document.title, window.location.pathname);
      setDiscordUser(user);

      if (user && sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)) {
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
      localStorage.setItem(DISCORD_AUTH_STORAGE_KEY, JSON.stringify({
        accessToken,
        user,
        expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000
      }));
      setDiscordUser(user);
      history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    } catch (error) {
      console.error('Discord login error:', error);
      setDiscordUser(null);
      alert('Discord login failed. Please try again.');
    } finally {
      if (discordUser && sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)) {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
        resumePendingCheckout();
      }
    }
    return;
  }

  const storedAuth = getStoredDiscordAuth();
  if (storedAuth) {
    setDiscordUser(storedAuth.user);
    return;
  }

  const authBaseUrl = getAuthBaseUrl();

  try {
    const response = await fetch(`${authBaseUrl}/api/me`, { credentials: 'include' });
    if (response.ok) {
      const payload = await response.json();
      setDiscordUser(payload.user || null);
    } else {
      setDiscordUser(null);
    }
  } catch (error) {
    console.warn('Could not refresh Discord session:', error);
    setDiscordUser(null);
  } finally {
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
  const dashboardLoginButton = document.getElementById('dashboardLoginButton');
  const pricingLoginNote = document.getElementById('pricingLoginNote');
  const deliveryAccountNote = document.getElementById('deliveryAccountNote');
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

  if (dashboardLoginButton) {
    if (user) {
      dashboardLoginButton.textContent = `Logged in as ${user.global_name || user.username}`;
      dashboardLoginButton.classList.add('is-logged-in');
      dashboardLoginButton.title = 'Click to log out';
      dashboardLoginButton.onclick = logoutDiscord;
    } else {
      dashboardLoginButton.textContent = 'Login with Discord';
      dashboardLoginButton.classList.remove('is-logged-in');
      dashboardLoginButton.title = 'Login with Discord to manage role listings';
      dashboardLoginButton.onclick = beginDiscordLogin;
    }
  }

  if (pricingLoginNote) {
    pricingLoginNote.textContent = user
      ? `Global user premium will be linked to ${user.global_name || user.username}.`
      : 'Login with Discord before buying so global premium can be linked to your user account.';
  }

  if (deliveryAccountNote) {
    deliveryAccountNote.textContent = user
      ? `One-time drops will deliver to ${user.global_name || user.username}.`
      : 'Login with Discord first so packs deliver to the right account.';
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
  updateLeaderboardSafe();
  updateTestimonialsSafe();
  updateFAQSafe();
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

function initCommandSearch() {
  const searchInput = document.getElementById('commandSearchInput');
  const filters = document.querySelectorAll('[data-command-filter]');
  const cards = Array.from(document.querySelectorAll('.command-card'));
  const empty = document.getElementById('commandEmpty');
  let activeFilter = 'all';

  if (!searchInput || !cards.length) return;

  const commandCategories = {
    '/spin': 'economy',
    '/leaderboard': 'utility',
    '/pvp': 'social',
    '/clan': 'social',
    '/roleshop list': 'admin'
  };

  cards.forEach((card) => {
    const title = card.querySelector('h3')?.textContent?.trim().toLowerCase() || '';
    const category = Object.entries(commandCategories).find(([command]) => title.startsWith(command))?.[1] || 'utility';
    card.dataset.commandCategory = category;

    if (!card.querySelector('.command-meta')) {
      const meta = document.createElement('span');
      meta.className = 'command-meta';
      meta.textContent = category === 'social' ? 'Social & Combat' : category.charAt(0).toUpperCase() + category.slice(1);
      card.appendChild(meta);
    }
  });

  const applyFilter = () => {
    const query = searchInput.value.trim().toLowerCase();
    let visibleCount = 0;

    cards.forEach((card) => {
      const matchesCategory = activeFilter === 'all' || card.dataset.commandCategory === activeFilter;
      const matchesQuery = !query || card.textContent.toLowerCase().includes(query);
      const isVisible = matchesCategory && matchesQuery;

      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    if (empty) {
      empty.hidden = visibleCount > 0;
    }
  };

  filters.forEach((filter) => {
    filter.addEventListener('click', () => {
      activeFilter = filter.dataset.commandFilter || 'all';
      filters.forEach((item) => item.classList.toggle('is-active', item === filter));
      applyFilter();
    });
  });

  searchInput.addEventListener('input', applyFilter);
  applyFilter();
}

function initPricingToggle() {
  const buttons = document.querySelectorAll('[data-plan-cycle]');
  const title = document.getElementById('premiumPlanTitle');
  const price = document.getElementById('premiumPlanPrice');
  const term = document.getElementById('premiumPlanTerm');
  const badge = document.getElementById('premiumPlanBadge');
  const anchor = document.getElementById('premiumPlanAnchor');
  const benefits = document.getElementById('premiumPlanBenefits');
  const planButton = document.getElementById('premiumPlanButton');

  if (!buttons.length || !title || !price || !term || !badge || !anchor || !benefits || !planButton) return;

  const renderPlan = (cycle) => {
    const plan = PREMIUM_PLAN_CONTENT[cycle] || PREMIUM_PLAN_CONTENT.yearly;

    title.textContent = plan.title;
    price.textContent = plan.price;
    term.textContent = plan.term;
    badge.textContent = plan.badge;
    anchor.textContent = plan.anchor;
    planButton.textContent = plan.button;
    planButton.dataset.planId = plan.planId;
    benefits.innerHTML = '';

    plan.benefits.forEach((benefit) => {
      const item = document.createElement('li');
      item.textContent = benefit;
      benefits.appendChild(item);
    });

    planButton.onclick = () => openCheckout(plan.getPriceId(), plan.planId);
    buttons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.planCycle === cycle);
    });
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => renderPlan(button.dataset.planCycle));
  });

  renderPlan('yearly');
}

function initStoreTabs() {
  const tabs = document.querySelectorAll('[data-store-tab]');
  const panels = document.querySelectorAll('[data-store-panel]');
  if (!tabs.length || !panels.length) return;

  const activateTab = (target) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.storeTab === target;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.storePanel !== target;
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.storeTab || 'subscriptions'));
  });

  activateTab('subscriptions');
}

async function refreshBotStatus() {
  const indicator = document.querySelector('.bot-status');
  if (!indicator) return;

  const startedAt = performance.now();
  try {
    const response = await fetch(`${getAuthBaseUrl()}/api/status`, { credentials: 'include' });
    const payload = response.ok ? await response.json() : {};
    const measuredLatency = Math.max(1, Math.round(performance.now() - startedAt));
    const latency = Number.isFinite(Number(payload.latencyMs)) ? Number(payload.latencyMs) : measuredLatency;
    indicator.textContent = `Bot Online • ${latency}ms`;
    indicator.classList.remove('is-offline');
  } catch (error) {
    indicator.textContent = 'Bot Status Unknown';
    indicator.classList.add('is-offline');
  }
}

function updateLeaderboardSafe() {
  if (!communityData.leaderboard) return;

  const leaderboard = document.querySelector('.leaderboard');
  if (!leaderboard) return;
  leaderboard.innerHTML = '';

  communityData.leaderboard.forEach(player => {
    const item = document.createElement('div');
    const rank = document.createElement('span');
    const playerName = document.createElement('span');
    const auraCount = document.createElement('span');

    item.className = 'leaderboard-item';
    rank.className = 'rank';
    playerName.className = 'player-name';
    auraCount.className = 'aura-count';

    rank.textContent = player.rank;
    playerName.textContent = player.name;
    auraCount.textContent = `${player.aura} aura`;

    item.append(rank, playerName, auraCount);
    leaderboard.appendChild(item);
  });
}

function updateTestimonialsSafe() {
  if (!communityData.testimonials) return;

  const testimonialsGrid = document.querySelector('.testimonials-grid');
  if (!testimonialsGrid) return;
  testimonialsGrid.innerHTML = '';

  communityData.testimonials.forEach(testimonial => {
    const card = document.createElement('div');
    const quote = document.createElement('p');
    const author = document.createElement('span');

    card.className = 'testimonial-card';
    author.className = 'testimonial-author';
    quote.textContent = `"${testimonial.text}"`;
    author.textContent = `- ${testimonial.author}`;

    card.append(quote, author);
    testimonialsGrid.appendChild(card);
  });
}

function updateFAQSafe() {
  if (!communityData.faqs) return;

  const faqItems = document.querySelector('.faq-items');
  if (!faqItems) return;
  faqItems.innerHTML = '';

  communityData.faqs.forEach(faq => {
    const item = document.createElement('details');
    const question = document.createElement('summary');
    const answer = document.createElement('p');

    item.className = 'faq-item';
    question.textContent = faq.question;
    answer.textContent = faq.answer;

    item.append(question, answer);
    faqItems.appendChild(item);
  });
}

// Load data on page load
document.addEventListener('DOMContentLoaded', loadData);
document.addEventListener('DOMContentLoaded', () => {
  updateDiscordLoginUI();
  initCommandSearch();
  initPricingToggle();
  initStoreTabs();
  refreshBotStatus();
  refreshDiscordSession();
  initRoleDashboard();
  initNavActiveState();
  initRoadmapVoting();
});

async function dashboardFetch(path, options = {}) {
  const authBaseUrl = getAuthBaseUrl();
  const dashboardToken = appState.auth.dashboardToken || localStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY);
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

function renderRolePermissionValidation(validation) {
  const banner = document.getElementById('rolePermissionBanner');
  const submitButton = document.getElementById('roleListingSubmitButton');
  if (!banner || !submitButton) return;

  if (!validation) {
    banner.hidden = true;
    submitButton.disabled = false;
    return;
  }

  banner.textContent = validation.message || 'Aurix is checking role permissions.';
  banner.hidden = false;
  banner.classList.toggle('is-ok', Boolean(validation.ok));
  banner.classList.toggle('is-warning', !validation.ok);
  submitButton.disabled = !validation.ok;
}

function resetRolePermissionValidation() {
  renderRolePermissionValidation(null);
}

function parseAuraPrice(value) {
  return Number(String(value || '').replace(/[^\d]/g, ''));
}

function formatAuraPrice(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? Number(digits).toLocaleString() : '';
}

function initAuraPriceInput() {
  const input = document.getElementById('roleListingPrice');
  if (!input) return;

  input.addEventListener('input', () => {
    input.value = formatAuraPrice(input.value);
    input.setCustomValidity('');
  });

  input.addEventListener('blur', () => {
    const price = parseAuraPrice(input.value);
    input.setCustomValidity(price >= 1 ? '' : 'Enter an aura price of at least 1.');
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
    const hasGuild = Boolean(document.getElementById('dashboardGuildSelect')?.value);
    list.innerHTML = hasGuild
      ? `<div class="dashboard-empty-state">
          <div class="empty-state-icon">RS</div>
          <h3>No roles listed yet</h3>
          <p>Choose a role, set an aura price, then save it to create this server's first role shop listing.</p>
        </div>`
      : `<div class="dashboard-empty-state">
          <div class="empty-state-icon">RS</div>
          <h3>Select a server to begin</h3>
          <p>Choose a server from the dropdown above to view, create, and manage its role shop listings.</p>
        </div>`;
    return;
  }

  const table = document.createElement('div');
  table.className = 'role-listing-table';
  table.innerHTML = `
    <div class="role-listing-row role-listing-head">
      <span>Role</span>
      <span>Price</span>
      <span>Status</span>
      <span>Purchases</span>
      <span>Actions</span>
    </div>
  `;

  listings.forEach((listing) => {
    const item = document.createElement('article');
    item.className = 'role-listing-row role-listing-item';
    item.innerHTML = `
      <div class="listing-role-cell">
        <strong>${escapeHtml(listing.name)}</strong>
        <small>${escapeHtml(listing.description || 'No description')}</small>
        <code>${escapeHtml(listing.roleId || listing.id)}</code>
      </div>
      <span>${Number(listing.price).toLocaleString()} aura</span>
      <span><span class="listing-status ${listing.enabled ? 'is-enabled' : 'is-disabled'}">${listing.enabled ? 'Enabled' : 'Disabled'}</span></span>
      <span>${listing.purchaseCount || 0}</span>
      <div class="role-listing-actions">
        <button type="button" data-listing-action="edit" data-listing-id="${listing.id}">Edit</button>
        <button type="button" data-listing-action="toggle" data-listing-id="${listing.id}" data-enabled="${listing.enabled ? 'false' : 'true'}">${listing.enabled ? 'Disable' : 'Enable'}</button>
        <button type="button" data-listing-action="delete" data-listing-id="${listing.id}">Delete</button>
      </div>
    `;
    item.dataset.listing = JSON.stringify(listing);
    table.appendChild(item);
  });

  list.appendChild(table);

  list.querySelectorAll('button[data-listing-action="edit"]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('.role-listing-item');
      const listing = JSON.parse(row?.dataset.listing || '{}');
      const roleSelect = document.getElementById('dashboardRoleSelect');
      const priceInput = document.getElementById('roleListingPrice');
      const descriptionInput = document.getElementById('roleListingDescription');
      const enabledInput = document.getElementById('roleListingEnabled');
      const submitButton = document.getElementById('roleListingSubmitButton');

      if (roleSelect && listing.roleId) {
        if (![...roleSelect.options].some((option) => option.value === listing.roleId)) {
          const option = document.createElement('option');
          option.value = listing.roleId;
          option.textContent = listing.name || listing.roleId;
          roleSelect.appendChild(option);
        }
        roleSelect.value = listing.roleId;
      }
      if (priceInput) priceInput.value = formatAuraPrice(listing.price || '');
      if (descriptionInput) descriptionInput.value = listing.description || '';
      if (enabledInput) enabledInput.checked = Boolean(listing.enabled);
      if (submitButton) submitButton.textContent = 'Update Role Listing';
      document.getElementById('roleListingForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setDashboardStatus(`Editing ${listing.name || 'role listing'}. Save to update it.`);
    });
  });

  list.querySelectorAll('button[data-listing-action="toggle"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await dashboardFetch(DASHBOARD_API.toggleRoleListing(button.dataset.listingId), {
          method: 'POST',
          body: JSON.stringify({ enabled: button.dataset.enabled === 'true' })
        });
        await loadRoleListings();
      } catch (error) {
        setDashboardStatus(error.message, true);
      }
    });
  });

  list.querySelectorAll('button[data-listing-action="delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('.role-listing-item');
      const listing = JSON.parse(row?.dataset.listing || '{}');
      if (!confirm(`Delete ${listing.name || 'this role listing'} from the shop?`)) {
        return;
      }

      try {
        await dashboardFetch(DASHBOARD_API.roleListing(button.dataset.listingId), { method: 'DELETE' });
        await loadRoleListings();
        setDashboardStatus('Role listing deleted.');
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

  const payload = await dashboardFetch(DASHBOARD_API.roleListings(guildId));
  renderRoleListings(payload.listings || []);
}

async function loadDashboardGuildData(guildId) {
  if (!guildId) {
    renderRoleOptions([]);
    renderRoleListings([]);
    resetRolePermissionValidation();
    return;
  }

  setDashboardStatus('Loading server roles...');
  const rolesPayload = await dashboardFetch(DASHBOARD_API.guildRoles(guildId));
  renderRoleOptions(rolesPayload.roles || []);
  renderRolePermissionValidation(rolesPayload.validation);
  await loadRoleListings();
  setDashboardStatus(rolesPayload.validation?.ok ? 'Ready. Create a listing or update an existing role.' : 'Fix the bot permissions before saving role listings.', !rolesPayload.validation?.ok);
}

async function initRoleDashboard() {
  const dashboard = document.getElementById('roleDashboard');
  if (!dashboard) return;

  const loginButton = document.getElementById('dashboardLoginButton');
  const guildSelect = document.getElementById('dashboardGuildSelect');
  const form = document.getElementById('roleListingForm');
  initAuraPriceInput();

  if (loginButton) {
    updateDiscordLoginUI();
  }
  guildSelect?.addEventListener('change', () => {
    loadDashboardGuildData(guildSelect.value).catch((error) => setDashboardStatus(error.message, true));
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const guildId = guildSelect?.value;
    const roleId = document.getElementById('dashboardRoleSelect')?.value;
    const priceInput = document.getElementById('roleListingPrice');
    const price = parseAuraPrice(priceInput?.value || '');
    const description = document.getElementById('roleListingDescription')?.value || '';
    const enabled = document.getElementById('roleListingEnabled')?.checked ?? true;

    if (!guildId || !roleId) {
      setDashboardStatus('Choose a server and role first.', true);
      return;
    }
    if (!Number.isInteger(price) || price < 1) {
      priceInput?.setCustomValidity('Enter an aura price of at least 1.');
      priceInput?.reportValidity();
      setDashboardStatus('Enter a valid aura price of at least 1.', true);
      return;
    }

    try {
      await dashboardFetch(DASHBOARD_API.roleListings(guildId), {
        method: 'POST',
        body: JSON.stringify({ roleId, price, description, enabled })
      });
      form.reset();
      guildSelect.value = guildId;
      document.getElementById('roleListingEnabled').checked = true;
      const submitButton = document.getElementById('roleListingSubmitButton');
      if (submitButton) submitButton.textContent = 'Save Role Listing';
      await loadDashboardGuildData(guildId);
      setDashboardStatus('Role listing saved.');
    } catch (error) {
      setDashboardStatus(error.message, true);
    }
  });

  try {
    const payload = await dashboardFetch(DASHBOARD_API.guilds);
    const guilds = payload.guilds || [];
    renderGuildOptions(guilds);
    setDashboardStatus(guilds.length ? 'Choose a server you manage.' : 'No manageable servers found for this Discord account.');
  } catch (error) {
    setDashboardStatus('Login with Discord to manage server role listings.');
  }
}

function initNavActiveState() {
  const navLinks = Array.from(document.querySelectorAll('.nav-menu a[href^="#"]'));
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if (!navLinks.length || !sections.length) return;

  const setActiveLink = (sectionId) => {
    navLinks.forEach((link) => {
      const isActive = link.getAttribute('href') === `#${sectionId}`;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target?.id) {
        setActiveLink(visible.target.id);
      }
    }, { rootMargin: '-32% 0px -55% 0px', threshold: [0.12, 0.28, 0.45] });

    sections.forEach((section) => observer.observe(section));
  }

  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && sections.some((section) => section.id === initialHash)) {
    setActiveLink(initialHash);
  } else {
    setActiveLink(sections[0].id);
  }
}

function initRoadmapVoting() {
  const voteButtons = document.querySelectorAll('.roadmap-vote');
  if (!voteButtons.length) return;

  voteButtons.forEach((button) => {
    const item = button.closest('[data-roadmap-id]');
    const count = button.querySelector('span');
    const key = `aurixRoadmapVotes:${item?.dataset.roadmapId || 'unknown'}`;
    const votedKey = `${key}:voted`;
    const storedVotes = Number(localStorage.getItem(key) || 0);
    const hasVoted = localStorage.getItem(votedKey) === '1';

    if (count) count.textContent = String(storedVotes);
    button.classList.toggle('has-voted', hasVoted);

    button.addEventListener('click', () => {
      const currentVotes = Number(localStorage.getItem(key) || 0);
      const nextVoted = localStorage.getItem(votedKey) !== '1';
      const nextVotes = Math.max(0, currentVotes + (nextVoted ? 1 : -1));

      localStorage.setItem(key, String(nextVotes));
      if (nextVoted) {
        localStorage.setItem(votedKey, '1');
      } else {
        localStorage.removeItem(votedKey);
      }

      if (count) count.textContent = String(nextVotes);
      button.classList.toggle('has-voted', nextVoted);
    });
  });
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
    const consent = document.getElementById('newsletterConsent');
    const button = this.querySelector('button');
    if (!consent?.checked) {
      consent?.reportValidity();
      return;
    }
    
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
