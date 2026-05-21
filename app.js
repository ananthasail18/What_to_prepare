/* ============================================================
   WHAT TO PREPARE — app.js
   Full application logic: Auth, Family, Meals, AI, Voice
   ============================================================ */

'use strict';

// ============================================================
// CONFIG — set your Groq API key and model here
// ============================================================
const GROQ_API_KEY = 'YOUR_GROQ_API_KEY_HERE'; // DO NOT COMMIT REAL KEYS
const GROQ_MODEL = 'llama-3.1-8b-instant';


// Simple password hash (no btoa — avoids encoding edge cases)
function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) {
    h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0;
  }
  return 'h_' + Math.abs(h).toString(36);
}

// ============================================================
// STATE
// ============================================================
let currentUser = null;
let setupState = { step: 0, tempMembers: [], currentMemberDraft: {} };
let recognition = null;
let isRecording = false;
let activeVoiceTarget = null;


// ============================================================
// STORAGE HELPERS
// ============================================================
window.APP_STATE = {};
let dbSyncTimeout = null;

function syncDatabase() {
  clearTimeout(dbSyncTimeout);
  dbSyncTimeout = setTimeout(() => {
    fetch('http://localhost:3001/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(window.APP_STATE)
    }).catch(err => console.error("DB Sync error:", err));
  }, 500);
}

const Storage = {
  get: (key) => window.APP_STATE[key] || null,
  set: (key, val) => {
    window.APP_STATE[key] = val;
    syncDatabase();
  },
  remove: (key) => {
    delete window.APP_STATE[key];
    syncDatabase();
  },

  getUsers: () => Storage.get('wtp_users') || {},
  saveUsers: (u) => Storage.set('wtp_users', u),

  getUserData: (email, key) => Storage.get(`wtp_${email}_${key}`),
  setUserData: (email, key, val) => Storage.set(`wtp_${email}_${key}`, val),

  getFamily: (email) => Storage.getUserData(email, 'family') || [],
  saveFamily: (email, f) => Storage.setUserData(email, 'family', f),

  getMealHistory: (email) => Storage.getUserData(email, 'meals') || [],
  saveMealHistory: (email, m) => Storage.setUserData(email, 'meals', m),

  getFridge: (email) => Storage.getUserData(email, 'fridge') || [],
  saveFridge: (email, f) => Storage.setUserData(email, 'fridge', f),

  isSetupDone: (email) => !!Storage.getUserData(email, 'setup_done'),
  markSetupDone: (email) => Storage.setUserData(email, 'setup_done', true),

  getSession: () => Storage.get('wtp_session'),
  saveSession: (email) => Storage.set('wtp_session', { email, ts: Date.now() }),
  clearSession: () => Storage.remove('wtp_session'),
};

// ============================================================
// UTILS
// ============================================================
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Thinking...`;
    btn.disabled = true;
  } else {
    if (btn.dataset.origText) btn.innerHTML = btn.dataset.origText;
    btn.disabled = false;
  }
}

function greetingByTime() {
  const h = new Date().getHours();
  if (h < 12) return '☀️ Good morning';
  if (h < 17) return '🌤️ Good afternoon';
  if (h < 21) return '🌇 Good evening';
  return '🌙 Good night';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function memberEmoji(member) {
  const dietEmojis = { vegetarian: '🥗', vegan: '🌱', jain: '🙏', eggetarian: '🍳', 'non-vegetarian': '🍗' };
  return dietEmojis[member.dietary] || '🧑';
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (!target) return;
  target.style.display = 'flex';
  target.style.flexDirection = 'column';
  requestAnimationFrame(() => target.classList.add('active'));

  // Refresh settings panel whenever it's shown
  if (id === 'screen-settings' && currentUser) {
    setTimeout(() => {
      renderSettingsFamilyList();
      renderSettingsMealLog(Storage.getMealHistory(currentUser.email).slice().reverse());
    }, 50);
  }
}

// ============================================================
// AUTH
// ============================================================
function switchAuthTab(tab) {
  const loginForm = document.getElementById('form-login');
  const regForm = document.getElementById('form-register');
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');
  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    tabLogin.classList.add('active');
    tabReg.classList.remove('active');
  } else {
    loginForm.classList.add('hidden');
    regForm.classList.remove('hidden');
    tabLogin.classList.remove('active');
    tabReg.classList.add('active');
  }
}

function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  const users = Storage.getUsers();
  if (!users[email]) { showErr(errEl, 'No account found. Please create one.'); return; }

  const stored = users[email].password;
  const matchesNew = stored === hashPassword(password);
  const matchesOld = stored === btoa(password); // backward compat

  if (!matchesNew && !matchesOld) { showErr(errEl, 'Incorrect password.'); return; }

  // Auto-migrate old btoa password to hashPassword
  if (matchesOld && !matchesNew) {
    users[email].password = hashPassword(password);
    Storage.saveUsers(users);
  }

  currentUser = { email, name: users[email].name };
  Storage.saveSession(email);
  afterLogin();
}

function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  errEl.classList.add('hidden');

  const users = Storage.getUsers();
  if (users[email]) { showErr(errEl, 'An account with this email already exists.'); return; }

  users[email] = { name, password: hashPassword(password), createdAt: Date.now() };
  Storage.saveUsers(users);

  currentUser = { email, name };
  Storage.saveSession(email);
  afterLogin();
}

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function handleLogout() {
  Storage.clearSession();
  currentUser = null;
  lastSuggestions = [];
  showScreen('screen-login');
  showToast('Signed out.', 'info');
}

function afterLogin() {
  if (!Storage.isSetupDone(currentUser.email)) {
    startFamilySetup();
  } else {
    showDashboard();
  }
}

// ============================================================
// GROQ API
// ============================================================
async function callAI(promptOrMessages) {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    throw new Error('No API key set. Open app.js and set GROQ_API_KEY at the top.');
  }

  const messages = Array.isArray(promptOrMessages) 
    ? promptOrMessages 
    : [{ role: "user", content: promptOrMessages }];

  const url = `https://api.groq.com/openai/v1/chat/completions`;
  const body = {
    model: GROQ_MODEL,
    messages: messages,
    temperature: 0.8,
    max_tokens: 1024,
    top_p: 0.95
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'No response from AI.';
}

// ============================================================
// FAMILY SETUP FORM (interactive, replaces chat setup)
// ============================================================
let fsetupCount = 2;          // chosen member count
let fsetupCurrent = 0;        // 0-based index of member being filled
let fsetupData = [];          // accumulated member objects

function startFamilySetup() {
  fsetupCount = 2;
  fsetupCurrent = 0;
  fsetupData = [];
  showScreen('screen-setup');

  // Show phase A (count picker), hide phase B
  document.getElementById('fsetup-phase-count').classList.remove('hidden');
  document.getElementById('fsetup-phase-member').classList.add('hidden');
  document.getElementById('fsetup-count-num').textContent = fsetupCount;
  document.getElementById('fsetup-count-dec').disabled = (fsetupCount <= 1);
}

function loadSampleFamily() {
  const sampleFamily = [
    {
      id: uuid(),
      name: 'Anant',
      age: 20,
      dietary: 'non-vegetarian',
      likes: ['biryani', 'pizza', 'South Indian', 'pasta'],
      dislikes: ['bitter gourd', 'okra'],
      notes: '',
    },
    {
      id: uuid(),
      name: 'Mom',
      age: 46,
      dietary: 'vegetarian',
      likes: ['dal', 'sabzi', 'roti', 'poha', 'upma'],
      dislikes: ['very spicy food', 'junk food'],
      notes: 'mild diabetic, prefers low-oil cooking',
    },
    {
      id: uuid(),
      name: 'Dad',
      age: 50,
      dietary: 'non-vegetarian',
      likes: ['chicken curry', 'rice', 'fish', 'dal makhani'],
      dislikes: ['raw salads', 'tofu'],
      notes: 'low-sodium diet, mild hypertension',
    },
  ];

  Storage.saveFamily(currentUser.email, sampleFamily);
  Storage.markSetupDone(currentUser.email);
  showToast('✅ Sample family loaded!', 'success');
  setTimeout(() => showDashboard(), 600);
}

function adjustMemberCount(delta) {
  fsetupCount = Math.max(1, Math.min(20, fsetupCount + delta));
  document.getElementById('fsetup-count-num').textContent = fsetupCount;
  document.getElementById('fsetup-count-dec').disabled = (fsetupCount <= 1);
}

function setMemberCount(n) {
  fsetupCount = n;
  document.getElementById('fsetup-count-num').textContent = n;
  document.getElementById('fsetup-count-dec').disabled = (n <= 1);
}

function startMemberForms() {
  fsetupCurrent = 0;
  fsetupData = Array.from({ length: fsetupCount }, () => ({ id: uuid() }));
  document.getElementById('fsetup-phase-count').classList.add('hidden');
  document.getElementById('fsetup-phase-member').classList.remove('hidden');
  renderMemberForm('forward');
}

function renderMemberForm(direction = 'forward') {
  const idx = fsetupCurrent;
  const total = fsetupCount;

  // Progress bar
  document.getElementById('fsetup-progress-fill').style.width = `${((idx) / total) * 100}%`;
  document.getElementById('fsetup-progress-label').textContent = `Member ${idx + 1} of ${total}`;

  // Dots
  const dotsEl = document.getElementById('fsetup-dots');
  dotsEl.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.className = 'fsetup-dot' + (i < idx ? ' done' : i === idx ? ' active' : '');
    dotsEl.appendChild(d);
  }

  // Avatar & title
  const avatars = ['🧑', '👩', '👨', '👧', '👦', '👴', '👵', '🧒'];
  document.getElementById('fsetup-member-avatar').textContent = avatars[idx % avatars.length];
  document.getElementById('fsetup-member-title').textContent =
    idx === 0 ? '👤 Tell me about the first person' : `👤 Now, member ${idx + 1}`;

  // Pre-fill from saved draft if going back
  const draft = fsetupData[idx] || {};
  document.getElementById('fs-name').value = draft.name || '';
  document.getElementById('fs-age').value = draft.age || '';
  document.getElementById('fs-likes').value = (draft.likes || []).join(', ');
  document.getElementById('fs-dislikes').value = (draft.dislikes || []).join(', ');
  document.getElementById('fs-notes').value = draft.notes || '';
  document.getElementById('fs-dietary').value = draft.dietary || '';

  // Diet pills
  document.querySelectorAll('.diet-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.value === (draft.dietary || ''));
    pill.onclick = () => {
      document.querySelectorAll('.diet-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      document.getElementById('fs-dietary').value = pill.dataset.value;
    };
  });

  // Next/Finish button label
  const nextBtn = document.getElementById('fsetup-next-btn');
  const isLast = idx === total - 1;
  nextBtn.innerHTML = isLast
    ? `Finish Setup <span class="btn-icon">✓</span>`
    : `Next Member <span class="btn-icon">→</span>`;

  // Back button visibility
  document.getElementById('fsetup-back-btn').style.visibility = idx === 0 ? 'hidden' : 'visible';

  // Slide animation
  const card = document.getElementById('fsetup-member-card');
  card.classList.remove('slide-in', 'slide-back');
  void card.offsetWidth; // reflow
  card.classList.add(direction === 'forward' ? 'slide-in' : 'slide-back');

  // Focus name
  setTimeout(() => document.getElementById('fs-name').focus(), 50);
}

function submitMemberForm(e) {
  e.preventDefault();
  const name = document.getElementById('fs-name').value.trim();
  const age = document.getElementById('fs-age').value;
  const dietary = document.getElementById('fs-dietary').value;
  const likesRaw = document.getElementById('fs-likes').value;
  const dislikesRaw = document.getElementById('fs-dislikes').value;
  const notes = document.getElementById('fs-notes').value.trim();

  fsetupData[fsetupCurrent] = {
    ...fsetupData[fsetupCurrent],
    name,
    age: age ? parseInt(age) : null,
    dietary,
    likes: likesRaw ? likesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    dislikes: dislikesRaw ? dislikesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    notes,
  };

  if (fsetupCurrent < fsetupCount - 1) {
    fsetupCurrent++;
    renderMemberForm('forward');
  } else {
    finishSetup();
  }
}

function prevMemberForm() {
  if (fsetupCurrent <= 0) return;
  // Save current draft before going back
  fsetupData[fsetupCurrent] = {
    ...fsetupData[fsetupCurrent],
    name: document.getElementById('fs-name').value.trim(),
    age: document.getElementById('fs-age').value ? parseInt(document.getElementById('fs-age').value) : null,
    dietary: document.getElementById('fs-dietary').value,
    likes: document.getElementById('fs-likes').value.split(',').map(s => s.trim()).filter(Boolean),
    dislikes: document.getElementById('fs-dislikes').value.split(',').map(s => s.trim()).filter(Boolean),
    notes: document.getElementById('fs-notes').value.trim(),
  };
  fsetupCurrent--;
  renderMemberForm('back');
}


function finishSetup() {
  const family = fsetupData.filter(m => m.name);
  Storage.saveFamily(currentUser.email, family);
  Storage.markSetupDone(currentUser.email);

  const names = family.map(m => m.name).join(', ');
  showToast(`🎉 Family saved: ${names}!`, 'success');
  setTimeout(() => showDashboard(), 900);
}


// ============================================================
// MESSAGE RENDERING
// ============================================================
function addMessage(containerId, role, text, quickReplies = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const el = document.createElement('div');
  el.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = formatMessageText(text);

  if (role === 'ai') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';
    el.appendChild(avatar);
  }

  el.appendChild(bubble);

  if (quickReplies.length > 0) {
    const qrDiv = document.createElement('div');
    qrDiv.className = 'quick-replies';
    quickReplies.forEach(qr => {
      const chip = document.createElement('button');
      chip.className = 'quick-reply-chip';
      chip.textContent = qr.label;
      chip.onclick = () => {
        qrDiv.remove();
        if (containerId === 'setup-messages') {
          document.getElementById('setup-input').value = qr.value || qr.label;
          sendSetupMessage();
        } else {
          document.getElementById('daily-input').value = qr.value || qr.label;
          sendDailyMessage();
        }
      };
      qrDiv.appendChild(chip);
    });
    container.appendChild(el);
    container.appendChild(qrDiv);
  } else {
    container.appendChild(el);
  }

  container.scrollTop = container.scrollHeight;
  return el;
}

function addThinkingIndicator(containerId) {
  const container = document.getElementById(containerId);
  const el = document.createElement('div');
  el.className = 'message ai';
  el.id = `thinking-${containerId}`;
  el.innerHTML = `<div class="message-avatar">🤖</div><div class="message-bubble"><div class="thinking-dots"><span></span><span></span><span></span></div></div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function removeThinkingIndicator(containerId) {
  const el = document.getElementById(`thinking-${containerId}`);
  if (el) el.remove();
}

function formatMessageText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

// ============================================================
// DASHBOARD
// ============================================================
function showDashboard() {
  showScreen('screen-dashboard');

  const name = currentUser.name || 'there';
  document.getElementById('greeting-text').textContent = `${greetingByTime()}, ${name}!`;
  document.getElementById('greeting-date').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  renderFamilyCards();
  renderYesterday();
  renderMealHistory();
  renderFridgeItems();
}

function renderFamilyCards() {
  const family = Storage.getFamily(currentUser.email);
  const container = document.getElementById('family-cards');
  container.innerHTML = '';

  if (family.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👨‍👩‍👧‍👦</div><p>No family members yet. Add someone!</p></div>`;
    return;
  }

  family.forEach(m => {
    const card = document.createElement('div');
    card.className = 'family-member-card';
    const dietLabel = m.dietary ? `• ${m.dietary}` : '';
    const notePreview = [m.likes?.slice(0, 2).join(', ')].filter(Boolean).join('');
    card.innerHTML = `
      <div class="family-card-avatar">${memberEmoji(m)}</div>
      <div class="family-card-name">${m.name}${m.age ? ` (${m.age})` : ''}</div>
      <div class="family-card-diet">${dietLabel}</div>
      <div class="family-card-notes">${notePreview}</div>
    `;
    container.appendChild(card);
  });
}

function renderYesterday() {
  const history = Storage.getMealHistory(currentUser.email);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const entry = history.find(h => h.date === yesterdayStr);

  const card = document.getElementById('yesterday-card');
  if (entry) {
    document.getElementById('yesterday-meal').textContent = entry.meal;
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

function renderMealHistory() {
  const history = Storage.getMealHistory(currentUser.email).slice().reverse().slice(0, 7);
  const container = document.getElementById('meal-history-list');
  container.innerHTML = '';

  if (history.length === 0) {
    container.innerHTML = `<div class="meal-history-empty">No meals logged yet. Start cooking! 🍳</div>`;
    renderSettingsMealLog([]);
    return;
  }

  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'meal-history-item';
    item.innerHTML = `
      <div>
        <div class="meal-history-name">🍽️ ${entry.meal}</div>
        <div class="meal-history-date">${formatDate(entry.date)}</div>
      </div>
    `;
    container.appendChild(item);
  });

  renderSettingsMealLog(Storage.getMealHistory(currentUser.email).slice().reverse());
}

function renderSettingsMealLog(history) {
  const container = document.getElementById('settings-meal-log');
  if (!container) return;
  container.innerHTML = '';
  if (history.length === 0) {
    container.innerHTML = `<div class="meal-history-empty">No meals logged yet.</div>`;
    return;
  }
  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'meal-history-item';
    item.innerHTML = `
      <div>
        <div class="meal-history-name">🍽️ ${entry.meal}</div>
        <div class="meal-history-date">${formatDate(entry.date)}</div>
      </div>
      <button class="btn-icon-round" onclick="deleteMealEntry('${entry.date}', '${entry.meal.replace(/'/g, "\\'")}')">🗑️</button>
    `;
    container.appendChild(item);
  });
}

function renderSettingsFamilyList() {
  const family = Storage.getFamily(currentUser.email);
  const container = document.getElementById('settings-family-list');
  container.innerHTML = '';

  if (family.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No members yet.</p></div>`;
    return;
  }

  family.forEach(m => {
    const item = document.createElement('div');
    item.className = 'settings-member-item';
    const meta = [
      m.dietary,
      m.likes?.length ? `Likes: ${m.likes.slice(0, 2).join(', ')}` : '',
      m.dislikes?.length ? `Dislikes: ${m.dislikes[0]}` : '',
    ].filter(Boolean).join(' · ');
    item.innerHTML = `
      <div class="settings-member-info">
        <div class="settings-member-name">${memberEmoji(m)} ${m.name}${m.age ? ` (${m.age})` : ''}</div>
        <div class="settings-member-meta">${meta || 'No preferences set'}</div>
      </div>
      <div class="settings-member-actions">
        <button class="btn-icon-round" onclick="showEditMemberModal('${m.id}')" title="Edit">✏️</button>
        <button class="btn-icon-round" onclick="deleteMember('${m.id}')" title="Delete">🗑️</button>
      </div>
    `;
    container.appendChild(item);
  });
}

// ============================================================
// FRIDGE INVENTORY
// ============================================================
function renderFridgeItems() {
  const container = document.getElementById('fridge-items-container');
  if (!container) return;
  const items = Storage.getFridge(currentUser.email);
  container.innerHTML = '';
  
  if (items.length === 0) {
    container.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem; padding: 4px;">Fridge is empty.</span>`;
    return;
  }
  
  items.forEach(item => {
    const pill = document.createElement('div');
    pill.className = 'fridge-item-pill';
    pill.innerHTML = `
      ${item}
      <button class="delete-btn" onclick="removeFridgeItem('${item.replace(/'/g, "\\'")}')">&times;</button>
    `;
    container.appendChild(pill);
  });
}

function addFridgeItemFromUI() {
  const input = document.getElementById('fridge-input');
  const val = input.value.trim();
  if (!val) return;
  
  // split by comma to allow bulk add
  const newItems = val.split(',').map(i => i.trim()).filter(Boolean);
  const items = Storage.getFridge(currentUser.email);
  
  let added = false;
  newItems.forEach(i => {
    if (!items.includes(i)) {
      items.push(i);
      added = true;
    }
  });
  
  if (added) {
    Storage.saveFridge(currentUser.email, items);
    renderFridgeItems();
  }
  input.value = '';
}

function removeFridgeItem(item) {
  let items = Storage.getFridge(currentUser.email);
  items = items.filter(i => i !== item);
  Storage.saveFridge(currentUser.email, items);
  renderFridgeItems();
}

// ============================================================
// MEAL LOGGING
// ============================================================
function logMeal(mealName) {
  const history = Storage.getMealHistory(currentUser.email);
  const today = todayStr();

  // Remove existing entry for today if any
  const filtered = history.filter(h => h.date !== today);
  filtered.push({ date: today, meal: mealName });
  Storage.saveMealHistory(currentUser.email, filtered);

  showToast(`Logged: ${mealName} ✓`, 'success');
  renderMealHistory();
  renderYesterday();

  // Hide log buttons after logging
  document.getElementById('meal-log-btns').innerHTML = `<span style="color:var(--success);font-size:0.9rem;">✅ Logged: ${mealName}</span>`;
}

function logCustomMeal() {
  document.getElementById('custom-meal-input').value = '';
  document.getElementById('modal-log-meal').classList.remove('hidden');
}

function confirmLogCustomMeal() {
  const meal = document.getElementById('custom-meal-input').value.trim();
  if (!meal) { showToast('Enter a meal name.', 'error'); return; }
  document.getElementById('modal-log-meal').classList.add('hidden');
  logMeal(meal);
}

function deleteMealEntry(date, meal) {
  const history = Storage.getMealHistory(currentUser.email);
  const updated = history.filter(h => !(h.date === date && h.meal === meal));
  Storage.saveMealHistory(currentUser.email, updated);
  renderMealHistory();
  showToast('Meal entry removed.', 'info');
}

function clearMealHistory() {
  if (!confirm('Clear all meal history? This cannot be undone.')) return;
  Storage.saveMealHistory(currentUser.email, []);
  renderMealHistory();
  showToast('Meal history cleared.', 'info');
}

// ============================================================
// DAILY CHAT (free-form)
// ============================================================
let dailyChatHistory = [];

function openDailyChat() {
  showScreen('screen-daily-chat');
  const container = document.getElementById('daily-messages');
  if (container.children.length === 0) {
    const name = currentUser.name;
    addMessage('daily-messages', 'ai',
      `Hi ${name}! 🍽️ Ask me anything about meals — "what's quick to make tonight?", "something for a cold day", "birthday dinner ideas" — I'm here!`,
      [
        { label: "🍛 Quick dinner ideas", value: "Suggest something quick for dinner tonight" },
        { label: "🎂 Special occasion", value: "It's a special occasion, what should I make?" },
        { label: "🥦 Something healthy", value: "Suggest a healthy meal for today" },
      ]
    );
  }
}

async function sendDailyMessage() {
  const input = document.getElementById('daily-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  addMessage('daily-messages', 'user', text);
  dailyChatHistory.push({ role: 'user', text });

  addThinkingIndicator('daily-messages');

  const family = Storage.getFamily(currentUser.email);
  const history = Storage.getMealHistory(currentUser.email);
  const recentMeals = history.slice(-5).map(h => h.meal);

  const familyDesc = family.map(m => {
    const parts = [`${m.name}`];
    if (m.dietary) parts.push(m.dietary);
    if (m.likes?.length) parts.push(`likes ${m.likes.join(', ')}`);
    if (m.dislikes?.length) parts.push(`dislikes ${m.dislikes.join(', ')}`);
    return `- ${parts.join(', ')}`;
  }).join('\n');

  const fridgeItems = Storage.getFridge(currentUser.email);
  const fridgeContext = fridgeItems.length > 0 
    ? `Available Fridge Ingredients: ${fridgeItems.join(', ')}` 
    : 'Available Fridge Ingredients: None specified.';

  const systemPrompt = `You are a warm, conversational meal planning assistant for an Indian family.

Family:
${familyDesc || 'No family data yet.'}

Recent meals (avoid repeating): ${recentMeals.join(', ') || 'None logged yet.'}

${fridgeContext}

Respond naturally and helpfully. Keep it practical and friendly. When suggesting meals, provide an expansive list of 5-10 diverse options to give the family plenty of choices. Highlight options with **bold dish names** and prioritize using the available fridge ingredients if any.
IMPORTANT TOOL USAGE: 
- Fridge items should include quantities when possible (e.g., "1L milk", "12 eggs").
- If the user buys/adds things, use: [ADD_FRIDGE: 1L milk, 12 eggs]. 
- If they use up an ingredient completely, use: [REMOVE_FRIDGE: milk]. 
- If they partially use an ingredient (e.g. used 2 eggs out of 12), update it by removing the old one and adding the new quantity: [REMOVE_FRIDGE: eggs] [ADD_FRIDGE: 10 eggs].`;

  const messages = [{ role: 'system', content: systemPrompt }];
  dailyChatHistory.forEach(h => {
    messages.push({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text });
  });

  try {
    let response = await callAI(messages);
    removeThinkingIndicator('daily-messages');
    
    // Parse commands using matchAll to catch multiple instances safely
    const addMatches = [...response.matchAll(/\[ADD_FRIDGE:\s*(.*?)\]/g)];
    const removeMatches = [...response.matchAll(/\[REMOVE_FRIDGE:\s*(.*?)\]/g)];
    
    if (addMatches.length > 0 || removeMatches.length > 0) {
      let currentFridge = Storage.getFridge(currentUser.email);
      let fridgeUpdated = false;

      // Process all removes first
      removeMatches.forEach(match => {
        const toRemove = match[1].split(',').map(i => i.trim().toLowerCase()).filter(Boolean);
        toRemove.forEach(item => {
          const oldLen = currentFridge.length;
          // Match by substring (so "eggs" removes "12 eggs")
          currentFridge = currentFridge.filter(existing => !existing.toLowerCase().includes(item));
          if (currentFridge.length !== oldLen) fridgeUpdated = true;
        });
      });

      // Process all adds next
      addMatches.forEach(match => {
        const toAdd = match[1].split(',').map(i => i.trim().toLowerCase()).filter(Boolean);
        toAdd.forEach(item => {
          if (!currentFridge.map(i => i.toLowerCase()).includes(item)) { 
            currentFridge.push(item); 
            fridgeUpdated = true; 
          }
        });
      });
      
      if (fridgeUpdated) {
        Storage.saveFridge(currentUser.email, currentFridge);
        renderFridgeItems(); // update dashboard UI in background
      }
      
      // Strip commands from UI
      response = response.replace(/\[ADD_FRIDGE:.*?\]/g, '').replace(/\[REMOVE_FRIDGE:.*?\]/g, '').trim();
    }

    addMessage('daily-messages', 'ai', response);
    dailyChatHistory.push({ role: 'ai', text: response });
  } catch (err) {
    removeThinkingIndicator('daily-messages');
    addMessage('daily-messages', 'ai', `Sorry, I ran into an error: ${err.message}`);
  }
}

// ============================================================
// FAMILY MEMBER MODAL (Add / Edit)
// ============================================================
function showAddMemberModal() {
  document.getElementById('modal-title').textContent = 'Add Family Member';
  document.getElementById('save-member-btn').textContent = 'Add Member';
  document.getElementById('member-id').value = '';
  document.getElementById('form-member').reset();
  document.getElementById('modal-member').classList.remove('hidden');
}

function showEditMemberModal(id) {
  const family = Storage.getFamily(currentUser.email);
  const member = family.find(m => m.id === id);
  if (!member) return;

  document.getElementById('modal-title').textContent = 'Edit Member';
  document.getElementById('save-member-btn').textContent = 'Save Changes';
  document.getElementById('member-id').value = id;
  document.getElementById('member-name').value = member.name || '';
  document.getElementById('member-age').value = member.age || '';
  document.getElementById('member-dietary').value = member.dietary || '';
  document.getElementById('member-likes').value = (member.likes || []).join(', ');
  document.getElementById('member-dislikes').value = (member.dislikes || []).join(', ');
  document.getElementById('member-notes').value = member.notes || '';
  document.getElementById('modal-member').classList.remove('hidden');
}

function saveMember(e) {
  e.preventDefault();
  const id = document.getElementById('member-id').value || uuid();
  const name = document.getElementById('member-name').value.trim();
  const age = document.getElementById('member-age').value;
  const dietary = document.getElementById('member-dietary').value;
  const likes = document.getElementById('member-likes').value.split(',').map(s => s.trim()).filter(Boolean);
  const dislikes = document.getElementById('member-dislikes').value.split(',').map(s => s.trim()).filter(Boolean);
  const notes = document.getElementById('member-notes').value.trim();

  const member = { id, name, age: age ? parseInt(age) : null, dietary, likes, dislikes, notes };

  let family = Storage.getFamily(currentUser.email);
  const idx = family.findIndex(m => m.id === id);
  if (idx >= 0) family[idx] = member;
  else family.push(member);

  Storage.saveFamily(currentUser.email, family);
  closeMemberModal();
  renderFamilyCards();
  renderSettingsFamilyList();
  showToast(`${name} saved! ✓`, 'success');
}

function deleteMember(id) {
  if (!confirm('Remove this family member?')) return;
  let family = Storage.getFamily(currentUser.email);
  family = family.filter(m => m.id !== id);
  Storage.saveFamily(currentUser.email, family);
  renderFamilyCards();
  renderSettingsFamilyList();
  showToast('Member removed.', 'info');
}

function closeMemberModal() {
  document.getElementById('modal-member').classList.add('hidden');
}

function closeModalOnBackdrop(e) {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
}

// ============================================================
// SETTINGS
// ============================================================
function showSettings() {
  showScreen('screen-settings');
  document.getElementById('settings-api-key').value = Storage.getApiKey();
  renderSettingsFamilyList();
  renderSettingsMealLog(Storage.getMealHistory(currentUser.email).slice().reverse());
}

function resetSetup() {
  if (!confirm('This will clear your family setup. You\'ll go through the setup process again. Continue?')) return;
  Storage.setUserData(currentUser.email, 'setup_done', null);
  Storage.saveFamily(currentUser.email, []);
  showToast('Setup reset. Redirecting to setup...', 'info');
  setTimeout(() => startFamilySetup(), 1200);
}

// ============================================================
// VOICE INPUT (Web Speech API)
// ============================================================
function initVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (activeVoiceTarget === 'daily') {
      document.getElementById('daily-input').value = transcript;
    }
    stopVoice();

    // Auto-send after voice input
    setTimeout(() => {
      if (activeVoiceTarget === 'daily') sendDailyMessage();
      activeVoiceTarget = null;
    }, 400);
  };

  recognition.onerror = () => { stopVoice(); showToast('Voice input failed. Try typing instead.', 'error'); };
  recognition.onend = () => { if (isRecording) stopVoice(); };
}

function toggleVoice(target) {
  if (!recognition) {
    showToast('Voice input not supported in this browser. Try Chrome.', 'error');
    return;
  }
  if (isRecording) {
    stopVoice();
    return;
  }
  activeVoiceTarget = target;
  isRecording = true;

  const btnId = 'daily-voice-btn';
  const indicatorId = 'voice-indicator-daily';
  document.getElementById(btnId)?.classList.add('recording');
  document.getElementById(indicatorId)?.classList.remove('hidden');

  recognition.start();
}

function stopVoice() {
  isRecording = false;
  try { recognition?.stop(); } catch (e) { }

  ['daily-voice-btn'].forEach(id => {
    document.getElementById(id)?.classList.remove('recording');
  });
  ['voice-indicator-daily'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
}

// ============================================================
// APP INIT
// ============================================================

function seedSampleAccount() {
  const SAMPLE_EMAIL = 'sample@sample.com';
  const users = Storage.getUsers();

  // Create the account if it doesn't exist yet
  if (!users[SAMPLE_EMAIL]) {
    users[SAMPLE_EMAIL] = {
      name: 'Sample User',
      password: hashPassword('sample'),
      createdAt: 0,
    };
    Storage.saveUsers(users);
  }

  // Seed family + mark setup done if not already
  if (!Storage.isSetupDone(SAMPLE_EMAIL)) {
    Storage.saveFamily(SAMPLE_EMAIL, [
      {
        id: 'sample-1',
        name: 'Anant',
        age: 20,
        dietary: 'non-vegetarian',
        likes: ['biryani', 'pizza', 'South Indian', 'pasta'],
        dislikes: ['bitter gourd', 'okra'],
        notes: '',
      },
      {
        id: 'sample-2',
        name: 'Mom',
        age: 46,
        dietary: 'vegetarian',
        likes: ['dal', 'sabzi', 'roti', 'poha', 'upma'],
        dislikes: ['very spicy food', 'junk food'],
        notes: 'mild diabetic, prefers low-oil cooking',
      },
      {
        id: 'sample-3',
        name: 'Dad',
        age: 50,
        dietary: 'non-vegetarian',
        likes: ['chicken curry', 'rice', 'fish', 'dal makhani'],
        dislikes: ['raw salads', 'tofu'],
        notes: 'low-sodium diet, mild hypertension',
      },
    ]);
    Storage.markSetupDone(SAMPLE_EMAIL);
  }

  // Seed Fridge if empty
  if (Storage.getFridge(SAMPLE_EMAIL).length === 0) {
    Storage.saveFridge(SAMPLE_EMAIL, [
      '1L milk',
      '12 eggs',
      '500g chicken breast',
      '200g paneer',
      '500g tomatoes',
      '1kg onions',
      'basmati rice',
      'spinach (palak)',
      '1kg idli/dosa batter',
      'fresh coconut',
      'curry leaves',
      'tamarind paste',
      'drumsticks (moringa)'
    ]);
  }

  // Seed Meal History if empty
  if (Storage.getMealHistory(SAMPLE_EMAIL).length === 0) {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const dayBefore = new Date(today); dayBefore.setDate(today.getDate() - 2);

    Storage.saveMealHistory(SAMPLE_EMAIL, [
      { date: dayBefore.toISOString().split('T')[0], meal: 'Chicken Curry & Rice' },
      { date: yesterday.toISOString().split('T')[0], meal: 'Palak Paneer & Roti' }
    ]);
  }
}

async function init() {
  initVoice();

  try {
    const res = await fetch('http://localhost:3001/');
    if (res.ok) {
      window.APP_STATE = await res.json();
    }
  } catch(e) {
    console.warn("Could not connect to local DB. Using fresh state.");
  }

  // Migrate from localStorage if DB is empty but local data exists
  if (Object.keys(window.APP_STATE).length === 0) {
    let migrated = false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('wtp_')) {
        try { window.APP_STATE[key] = JSON.parse(localStorage.getItem(key)); migrated = true; } 
        catch { window.APP_STATE[key] = localStorage.getItem(key); migrated = true; }
      }
    }
    if (migrated) syncDatabase();
  }

  seedSampleAccount(); // always ensure sample account exists

  // Check existing session
  const session = Storage.getSession();
  if (session?.email) {
    const users = Storage.getUsers();
    if (users[session.email]) {
      currentUser = { email: session.email, name: users[session.email].name };
      if (!Storage.isSetupDone(currentUser.email)) {
        startFamilySetup();
      } else {
        showDashboard();
      }
      return;
    }
  }

  showScreen('screen-login');
}

document.addEventListener('DOMContentLoaded', init);
