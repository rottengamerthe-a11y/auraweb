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
      answer: 'Yes, Aurix is completely free! All core features are available without any paywalls.'
    },
    {
      question: 'How can I report bugs or suggest features?',
      answer: 'Join our official Discord server and use the #suggestions and #bug-reports channels. We read and respond to all feedback!'
    }
  ]
};

let communityData = {};

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
