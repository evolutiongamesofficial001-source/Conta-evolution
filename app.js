/* ═══════════════════════════════════════════════════
   EVOLUTION ACCOUNT — APP.JS
   Firebase Realtime Database + Auth via Email Link
   ═══════════════════════════════════════════════════ */

// ─── FIREBASE CONFIG ───────────────────────────────
const firebaseConfig1 = {
  databaseURL: "https://evoconta1-d3146-default-rtdb.europe-west1.firebasedatabase.app/"
};
const firebaseConfig2 = {
  databaseURL: "https://evoconta2-82e77-default-rtdb.firebaseio.com/"
};

const app1 = firebase.initializeApp(firebaseConfig1, "primary");
const app2 = firebase.initializeApp(firebaseConfig2, "backup");

const db1 = firebase.database(app1);
const db2 = firebase.database(app2);

async function dbSet(path, data) {
  await Promise.allSettled([
    db1.ref(path).set(data),
    db2.ref(path).set(data)
  ]);
}

async function dbGet(path) {
  try {
    const snap = await db1.ref(path).once('value');
    if (snap.exists()) return snap.val();
  } catch (e) { /* fallback */ }
  try {
    const snap = await db2.ref(path).once('value');
    return snap.val();
  } catch (e) { return null; }
}

async function dbRemove(path) {
  await Promise.allSettled([
    db1.ref(path).remove(),
    db2.ref(path).remove()
  ]);
}

// ─── STATE ────────────────────────────────────────
let currentUser = null;
let pendingRegistration = null;

// ─── INIT ─────────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(async () => {
    const splash = document.getElementById('splash');
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
      document.getElementById('app').classList.remove('hidden');
      bootApp();
    }, 600);
  }, 1800);
});

async function bootApp() {
  const saved = localStorage.getItem('evo_session');
  if (saved) {
    try {
      const session = JSON.parse(saved);
      if (session.autoLogin && session.username) {
        const userData = await dbGet(`users/${session.username}`);
        if (userData && userData.verified) {
          currentUser = userData;
          await enterDashboard();
          return;
        }
      }
    } catch (e) { /* ignore */ }
  }
  showScreen('login-form');
  document.getElementById('auth-screen').classList.add('active');
}

// ─── SCREEN MANAGEMENT ────────────────────────────
function showScreen(formId) {
  const authForms = ['login-form','register-form','verify-form','forgot-form'];
  if (authForms.includes(formId)) {
    authForms.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    document.getElementById(formId).classList.remove('hidden');
    clearErrors();
  }
}

function clearErrors() {
  document.querySelectorAll('.error-msg, .success-msg').forEach(el => {
    el.classList.add('hidden');
    el.textContent = '';
  });
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

function showSuccess(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

// ─── LOADING STATE ─────────────────────────────────
function setLoading(btnId, loading, originalHTML) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn._original = btn.innerHTML;
    btn.innerHTML = `<div class="spinner"></div>`;
    btn.disabled = true;
  } else {
    btn.innerHTML = originalHTML || btn._original || '';
    btn.disabled = false;
  }
}

// ─── REGISTER ─────────────────────────────────────
async function handleRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-username').value.trim().toLowerCase();
  const email    = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;
  const dob      = document.getElementById('reg-dob').value;
  const country  = document.getElementById('reg-country').value;
  const secQ     = document.getElementById('reg-sec-question').value;
  const secA     = document.getElementById('reg-sec-answer').value.trim().toLowerCase();

  if (!name || !username || !email || !password || !dob || !country || !secQ || !secA) {
    return showError('register-error', 'Preencha todos os campos.');
  }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return showError('register-error', 'Username inválido. Use 3–20 caracteres: letras, números, _');
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    return showError('register-error', 'Email inválido.');
  }
  if (password.length < 6) {
    return showError('register-error', 'Senha muito curta (mínimo 6 caracteres).');
  }

  setLoading('register-btn', true);

  const existingUser = await dbGet(`users/${username}`);
  if (existingUser) {
    setLoading('register-btn', false);
    return showError('register-error', 'Username já está em uso.');
  }

  const existingEmail = await dbGet(`emails/${btoa(email)}`);
  if (existingEmail) {
    setLoading('register-btn', false);
    return showError('register-error', 'Email já cadastrado.');
  }

  // Generate verification token
  const verifyToken = generateToken();
  const verifyExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h

  pendingRegistration = { name, username, email, password: btoa(password), dob, country, secQuestion: secQ, secAnswer: secA };

  // Store pending verification in Firebase
  await dbSet(`pending_verifications/${btoa(email)}`, {
    ...pendingRegistration,
    verifyToken,
    verifyExpiry,
    createdAt: new Date().toISOString()
  });

  setLoading('register-btn', false);

  // Show verification screen
  document.getElementById('verify-email-display').textContent = email;
  showScreen('verify-form');

  // Simulate sending email (in production integrate with EmailJS, SendGrid, etc.)
  // For demo: log the token to console and show in toast
  console.log(`[EVO] Verification link: ?verify=${verifyToken}&email=${btoa(email)}`);
  showToast('Email de verificação enviado!');

  // Check URL params in case user already clicked link
  checkVerifyParam();
}

// ─── CHECK VERIFY URL PARAM ────────────────────────
function checkVerifyParam() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('verify');
  const emailB64 = params.get('email');
  if (token && emailB64) {
    autoVerifyFromLink(token, emailB64);
  }
}

async function autoVerifyFromLink(token, emailB64) {
  const pending = await dbGet(`pending_verifications/${emailB64}`);
  if (!pending) return;
  if (pending.verifyToken !== token) return;
  if (Date.now() > pending.verifyExpiry) return;

  // Complete registration
  await completeRegistration(pending);

  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);
}

// ─── VERIFY EMAIL (user clicks "Já verifiquei") ────
async function handleVerifyEmail() {
  setLoading('verify-btn', true);

  // In a real system: the link click sets a flag in the DB
  // Here we also accept if pending registration exists and user clicks confirm
  // We check if there's a pending registration stored locally
  const emailDisplay = document.getElementById('verify-email-display').textContent;
  const emailB64 = btoa(emailDisplay);

  const pending = await dbGet(`pending_verifications/${emailB64}`);

  if (!pending) {
    setLoading('verify-btn', false);
    return showError('verify-error', 'Dados de registro não encontrados. Tente se registrar novamente.');
  }

  if (Date.now() > pending.verifyExpiry) {
    setLoading('verify-btn', false);
    await dbRemove(`pending_verifications/${emailB64}`);
    return showError('verify-error', 'Link expirado. Por favor, registre-se novamente.');
  }

  // For demo mode: allow confirm after seeing the token in console
  // In production this would only proceed if the link was clicked
  if (pending.verified || pending._demoConfirmed) {
    await completeRegistration(pending);
  } else {
    // Demo: automatically mark as confirmed so user can proceed
    await dbSet(`pending_verifications/${emailB64}/_demoConfirmed`, true);
    await completeRegistration(pending);
  }

  setLoading('verify-btn', false);
}

async function completeRegistration(pending) {
  const evoId = generateEvoId();
  const joinedAt = new Date().toISOString();

  const userData = {
    name: pending.name,
    username: pending.username,
    email: pending.email,
    password: pending.password,
    dob: pending.dob,
    country: pending.country,
    secQuestion: pending.secQuestion,
    secAnswer: pending.secAnswer,
    evoId,
    joinedAt,
    verified: true,
    avatar: null,
    settings: {
      theme: 'dark',
      language: 'pt-BR',
      autoLogin: true,
      pushNotif: true
    }
  };

  await dbSet(`users/${userData.username}`, userData);
  await dbSet(`emails/${btoa(userData.email)}`, { username: userData.username });

  // Remove pending
  await dbRemove(`pending_verifications/${btoa(userData.email)}`);

  // Welcome notification
  await dbSet(`notifications/${userData.username}/notif_welcome`, {
    id: 'notif_welcome',
    title: 'Bem-vindo à Evolution! 🚀',
    body: 'Sua conta foi criada e verificada com sucesso. Explore o painel e personalize seu perfil.',
    time: new Date().toISOString(),
    read: false,
    type: 'system'
  });

  pendingRegistration = null;
  currentUser = userData;

  localStorage.setItem('evo_session', JSON.stringify({ username: userData.username, autoLogin: true }));

  showToast('Conta criada com sucesso!');
  setTimeout(() => enterDashboard(), 800);
}

async function resendVerification() {
  const emailDisplay = document.getElementById('verify-email-display').textContent;
  if (!emailDisplay) return;

  const emailB64 = btoa(emailDisplay);
  const pending = await dbGet(`pending_verifications/${emailB64}`);

  if (!pending) {
    return showError('verify-error', 'Sessão expirada. Por favor, registre-se novamente.');
  }

  // Refresh token and expiry
  const verifyToken = generateToken();
  const verifyExpiry = Date.now() + 24 * 60 * 60 * 1000;

  await dbSet(`pending_verifications/${emailB64}/verifyToken`, verifyToken);
  await dbSet(`pending_verifications/${emailB64}/verifyExpiry`, verifyExpiry);

  console.log(`[EVO] Novo link: ?verify=${verifyToken}&email=${emailB64}`);
  showSuccess('verify-success', 'Email reenviado! Verifique sua caixa de entrada.');
  setTimeout(() => {
    const el = document.getElementById('verify-success');
    if (el) el.classList.add('hidden');
  }, 4000);
}

// ─── LOGIN ─────────────────────────────────────────
async function handleLogin() {
  const identifier = document.getElementById('login-identifier').value.trim().toLowerCase();
  const password   = document.getElementById('login-password').value;

  if (!identifier || !password) {
    return showError('login-error', 'Preencha todos os campos.');
  }

  setLoading('login-btn', true);

  let username = identifier;

  if (identifier.includes('@')) {
    const emailRef = await dbGet(`emails/${btoa(identifier)}`);
    if (!emailRef) {
      setLoading('login-btn', false);
      return showError('login-error', 'Email não encontrado.');
    }
    username = emailRef.username;
  }

  const userData = await dbGet(`users/${username}`);

  if (!userData) {
    setLoading('login-btn', false);
    return showError('login-error', 'Usuário não encontrado.');
  }
  if (userData.password !== btoa(password)) {
    setLoading('login-btn', false);
    return showError('login-error', 'Senha incorreta.');
  }
  if (!userData.verified) {
    setLoading('login-btn', false);
    return showError('login-error', 'Conta não verificada. Verifique seu email.');
  }

  currentUser = userData;

  const autoLogin = userData.settings?.autoLogin !== false;
  localStorage.setItem('evo_session', JSON.stringify({ username, autoLogin }));

  setLoading('login-btn', false);
  showToast('Bem-vindo de volta, ' + userData.name.split(' ')[0] + '!');
  setTimeout(() => enterDashboard(), 600);
}

// ─── FORGOT PASSWORD ───────────────────────────────
async function loadSecurityQuestion() {
  const email = document.getElementById('forgot-email').value.trim().toLowerCase();
  if (!email) return showError('forgot-error', 'Digite seu email.');

  const emailRef = await dbGet(`emails/${btoa(email)}`);
  if (!emailRef) return showError('forgot-error', 'Email não encontrado.');

  const userData = await dbGet(`users/${emailRef.username}`);
  if (!userData) return showError('forgot-error', 'Conta não encontrada.');

  const questions = {
    pet:    'Qual o nome do seu primeiro animal de estimação?',
    city:   'Em qual cidade você nasceu?',
    school: 'Qual o nome da sua primeira escola?',
    mother: 'Qual o nome do meio da sua mãe?',
    car:    'Qual foi o modelo do seu primeiro carro?'
  };

  document.getElementById('sec-question-label').textContent = questions[userData.secQuestion] || '—';
  document.getElementById('sec-question-block').classList.remove('hidden');
  document.getElementById('forgot-email').dataset.username = userData.username;
}

async function handleResetPassword() {
  const answer   = document.getElementById('forgot-answer').value.trim().toLowerCase();
  const newPw    = document.getElementById('forgot-new-pw').value;
  const username = document.getElementById('forgot-email').dataset.username;

  if (!answer || !newPw) return showError('forgot-error', 'Preencha todos os campos.');
  if (newPw.length < 6) return showError('forgot-error', 'Senha muito curta.');

  const userData = await dbGet(`users/${username}`);
  if (!userData) return showError('forgot-error', 'Conta não encontrada.');
  if (userData.secAnswer !== answer) return showError('forgot-error', 'Resposta incorreta.');

  await dbSet(`users/${username}/password`, btoa(newPw));
  showToast('Senha redefinida com sucesso!');
  setTimeout(() => showScreen('login-form'), 1000);
}

// ─── DASHBOARD ────────────────────────────────────
async function enterDashboard() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('active');

  // Start session timer
  if (!sessionStorage.getItem('evo_session_start')) {
    sessionStorage.setItem('evo_session_start', new Date().toISOString());
    logActivity('login', 'Login realizado', getDeviceInfo());
  }

  populateDashboard();
  loadNotifications();
  applySettings();
  updateProfileCompletion();
}

function populateDashboard() {
  if (!currentUser) return;
  const u = currentUser;

  if (u.avatar) {
    document.getElementById('avatar-img').src = u.avatar;
    document.getElementById('avatar-img').classList.remove('hidden');
    document.getElementById('avatar-initials').style.display = 'none';
  } else {
    const initials = u.name.split(' ').map(n => n[0]).slice(0,2).join('');
    document.getElementById('avatar-initials').textContent = initials;
    document.getElementById('avatar-initials').style.display = '';
  }

  document.getElementById('profile-display-name').textContent = u.name;
  document.getElementById('profile-display-username').textContent = '@' + u.username;

  const bioEl = document.getElementById('profile-display-bio');
  if (bioEl) bioEl.textContent = u.bio || '';

  document.getElementById('evo-id-value').textContent = u.evoId;
  document.getElementById('settings-evo-id').textContent = u.evoId;

  document.getElementById('info-name').textContent    = u.name;
  document.getElementById('info-email').textContent   = u.email;
  document.getElementById('info-country').textContent = getCountryName(u.country);
  document.getElementById('info-dob').textContent     = formatDate(u.dob);
  document.getElementById('info-joined').textContent  = formatDate(u.joinedAt);
  document.getElementById('stat-evo-id').textContent  = u.evoId.split('-')[1] || u.evoId;

  const days = Math.max(1, Math.floor((Date.now() - new Date(u.joinedAt).getTime()) / 86400000) + 1);
  document.getElementById('stat-days').textContent = days;
}

async function loadNotifications() {
  if (!currentUser) return;
  const notifs = await dbGet(`notifications/${currentUser.username}`);

  const list = document.getElementById('notif-list');
  list.innerHTML = '';

  if (!notifs || Object.keys(notifs).length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <p>Nenhuma notificação ainda</p>
    </div>`;
    updateBadge(0);
    return;
  }

  const arr = Object.values(notifs).sort((a, b) => new Date(b.time) - new Date(a.time));
  const unread = arr.filter(n => !n.read).length;
  updateBadge(unread);
  document.getElementById('stat-notifs').textContent = arr.length;
  document.getElementById('notif-count-label').textContent = `${arr.length} notificação${arr.length !== 1 ? 'ões' : ''}`;

  const icons = {
    system: `<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    news:   `<svg viewBox="0 0 24 24"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6z"/></svg>`,
    update: `<svg viewBox="0 0 24 24"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>`
  };

  arr.forEach((n, i) => {
    const div = document.createElement('div');
    div.className = `notif-item ${n.read ? '' : 'unread'}`;
    div.style.animationDelay = `${i * 0.06}s`;
    div.innerHTML = `
      <div class="notif-icon">${icons[n.type] || icons.system}</div>
      <div style="flex:1;min-width:0">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-body">${escapeHtml(n.body)}</div>
      </div>
      <span class="notif-time">${timeAgo(n.time)}</span>
      ${!n.read ? '<div class="notif-dot"></div>' : ''}
    `;
    div.addEventListener('click', () => markNotifRead(n.id, div));
    list.appendChild(div);
  });
}

async function markNotifRead(id, el) {
  if (!currentUser) return;
  await dbSet(`notifications/${currentUser.username}/${id}/read`, true);
  el.classList.remove('unread');
  const dot = el.querySelector('.notif-dot');
  if (dot) dot.remove();
  const badge = parseInt(document.getElementById('notif-badge').textContent || '0') - 1;
  updateBadge(Math.max(0, badge));
}

async function markAllRead() {
  if (!currentUser) return;
  const notifs = await dbGet(`notifications/${currentUser.username}`);
  if (!notifs) return;
  for (const id of Object.keys(notifs)) {
    await dbSet(`notifications/${currentUser.username}/${id}/read`, true);
  }
  loadNotifications();
  showToast('Todas marcadas como lidas');
}

function updateBadge(n) {
  // Sidebar badge
  const badge = document.getElementById('notif-badge');
  if (badge) {
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
    if (n > 0) {
      badge.classList.add('pop');
      setTimeout(() => badge.classList.remove('pop'), 400);
    }
  }
  // Bottom nav badge
  const bnav = document.getElementById('bnav-badge');
  if (bnav) {
    bnav.textContent = n > 9 ? '9+' : n;
    bnav.style.display = n > 0 ? 'flex' : 'none';
  }
}

// ─── TAB SWITCHING ────────────────────────────────
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  document.getElementById('tab-' + tab).classList.add('active');

  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  // Bottom nav
  document.querySelectorAll('.bnav-item').forEach(n => n.classList.remove('active'));

  // Activate the clicked button and its twin
  const tabAttr = btn.getAttribute('data-tab');
  document.querySelectorAll(`[data-tab="${tabAttr}"]`).forEach(el => el.classList.add('active'));

  if (tab === 'activity') renderActivityLog();
}

// ─── AVATAR ───────────────────────────────────────
function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const img = new Image();
    img.onload = async function() {
      const canvas = document.createElement('canvas');
      const MAX = 120;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
      else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL('image/jpeg', 0.75);

      document.getElementById('avatar-img').src = base64;
      document.getElementById('avatar-img').classList.remove('hidden');
      document.getElementById('avatar-initials').style.display = 'none';

      if (currentUser) {
        await dbSet(`users/${currentUser.username}/avatar`, base64);
        currentUser.avatar = base64;
        logActivity('avatar_update', 'Foto de perfil atualizada');
        updateProfileCompletion();
        showToast('Foto atualizada!');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function applySettings() {
  if (!currentUser) return;
  const s = currentUser.settings || {};
  setTheme(s.theme || 'dark', false);
  const langSel = document.getElementById('language-select');
  if (langSel && s.language) langSel.value = s.language;
  const autoToggle = document.getElementById('auto-login-toggle');
  if (autoToggle) autoToggle.checked = s.autoLogin !== false;
  const pushToggle = document.getElementById('push-notif-toggle');
  if (pushToggle) pushToggle.checked = s.pushNotif !== false;
  const compactToggle = document.getElementById('compact-mode-toggle');
  if (compactToggle) {
    compactToggle.checked = !!s.compactMode;
    document.documentElement.setAttribute('data-compact', s.compactMode ? 'true' : 'false');
  }
  const onlineToggle = document.getElementById('online-status-toggle');
  if (onlineToggle) onlineToggle.checked = s.onlineStatus !== false;
}

function setTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`theme-${theme}-btn`);
  if (btn) btn.classList.add('active');
  if (save && currentUser) saveSetting('theme', theme);
}

async function saveSetting(key, value) {
  if (!currentUser) return;
  currentUser.settings = currentUser.settings || {};
  currentUser.settings[key] = value;
  await dbSet(`users/${currentUser.username}/settings/${key}`, value);
  if (key === 'autoLogin') {
    const session = JSON.parse(localStorage.getItem('evo_session') || '{}');
    session.autoLogin = value;
    localStorage.setItem('evo_session', JSON.stringify(session));
  }
}

// ─── CHANGE PASSWORD ──────────────────────────────
function openChangePassword() {
  document.getElementById('modal-change-pw').classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

async function handleChangePassword() {
  const answer  = document.getElementById('cpw-answer').value.trim().toLowerCase();
  const newPw   = document.getElementById('cpw-new').value;
  const confirm = document.getElementById('cpw-confirm').value;

  if (!answer || !newPw || !confirm) return showError('cpw-error', 'Preencha todos os campos.');
  if (newPw !== confirm) return showError('cpw-error', 'As senhas não coincidem.');
  if (newPw.length < 6) return showError('cpw-error', 'Senha muito curta.');
  if (currentUser.secAnswer !== answer) return showError('cpw-error', 'Resposta de segurança incorreta.');

  await dbSet(`users/${currentUser.username}/password`, btoa(newPw));
  currentUser.password = btoa(newPw);
  closeModal('modal-change-pw');
  showToast('Senha alterada com sucesso!');
}

// ─── LOGOUT ───────────────────────────────────────
function handleLogout() {
  localStorage.removeItem('evo_session');
  currentUser = null;
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('active');
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('auth-screen').classList.add('active');
  showScreen('login-form');
  document.querySelectorAll('input').forEach(i => { if (i.type !== 'checkbox') i.value = ''; });
}

// ─── DELETE ACCOUNT ───────────────────────────────
async function confirmDeleteAccount() {
  if (!currentUser) return;
  const confirmed = confirm(`Tem certeza que deseja excluir a conta "${currentUser.username}"? Esta ação é irreversível.`);
  if (!confirmed) return;

  await dbRemove(`users/${currentUser.username}`);
  await dbRemove(`emails/${btoa(currentUser.email)}`);
  await dbRemove(`notifications/${currentUser.username}`);
  localStorage.removeItem('evo_session');
  showToast('Conta excluída.');
  setTimeout(() => handleLogout(), 800);
}

// ─── EVO ID COPY ──────────────────────────────────
function copyEvoId() {
  if (!currentUser) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(currentUser.evoId).then(() => showToast('EVO ID copiado!'));
  } else {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = currentUser.evoId;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('EVO ID copiado!');
  }
}

// ─── HELPERS ──────────────────────────────────────
function generateEvoId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `EVO-${seg(4)}-${seg(4)}-${seg(4)}`;
}

function generateToken(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({length}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getCountryName(code) {
  const map = {
    BR: '🇧🇷 Brasil', US: '🇺🇸 Estados Unidos', PT: '🇵🇹 Portugal',
    AR: '🇦🇷 Argentina', FR: '🇫🇷 França', DE: '🇩🇪 Alemanha',
    JP: '🇯🇵 Japão', GB: '🇬🇧 Reino Unido', CA: '🇨🇦 Canadá',
    MX: '🇲🇽 México', OTHER: '🌍 Outro'
  };
  return map[code] || code;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return '—'; }
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff/60)}m`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h`;
  return `${Math.floor(diff/86400)}d`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2800);
}

// ─── PW TOGGLE ────────────────────────────────────
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  btn.style.opacity = isText ? '1' : '0.5';
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
});

// ─── CHECK URL PARAMS ON LOAD ─────────────────────
window.addEventListener('DOMContentLoaded', () => {
  checkVerifyParam();
});

// ─── LOGOUT CONFIRMATION ─────────────────────────
function confirmLogout() {
  document.getElementById('modal-confirm-logout').classList.remove('hidden');
}

// ─── EDIT PROFILE ─────────────────────────────────
function openEditProfile() {
  if (!currentUser) return;
  document.getElementById('edit-name').value = currentUser.name || '';
  document.getElementById('edit-bio').value = currentUser.bio || '';
  document.getElementById('edit-country').value = currentUser.country || '';
  updateBioCount();
  document.getElementById('modal-edit-profile').classList.remove('hidden');
}

function updateBioCount() {
  const bio = document.getElementById('edit-bio');
  const counter = document.getElementById('bio-char-count');
  if (bio && counter) {
    counter.textContent = `${bio.value.length}/120`;
    bio.addEventListener('input', () => {
      counter.textContent = `${bio.value.length}/120`;
    });
  }
}

async function handleEditProfile() {
  const name    = document.getElementById('edit-name').value.trim();
  const bio     = document.getElementById('edit-bio').value.trim();
  const country = document.getElementById('edit-country').value;

  if (!name) return showError('edit-profile-error', 'Nome é obrigatório.');
  if (name.length < 2) return showError('edit-profile-error', 'Nome muito curto.');

  setLoading('edit-profile-btn', true);

  await dbSet(`users/${currentUser.username}/name`, name);
  await dbSet(`users/${currentUser.username}/bio`, bio);
  await dbSet(`users/${currentUser.username}/country`, country);

  currentUser.name = name;
  currentUser.bio = bio;
  currentUser.country = country;

  setLoading('edit-profile-btn', false);
  closeModal('modal-edit-profile');
  populateDashboard();
  updateProfileCompletion();
  logActivity('profile_update', 'Perfil atualizado');
  showToast('Perfil atualizado com sucesso!');
}

// ─── PROFILE COMPLETION ───────────────────────────
function updateProfileCompletion() {
  if (!currentUser) return;
  const u = currentUser;

  const fields = [
    { key: 'name',    label: 'Nome completo',  done: !!u.name },
    { key: 'bio',     label: 'Bio',             done: !!u.bio && u.bio.length > 5 },
    { key: 'avatar',  label: 'Foto de perfil',  done: !!u.avatar },
    { key: 'country', label: 'País',            done: !!u.country },
    { key: 'dob',     label: 'Data de nascimento', done: !!u.dob },
    { key: 'email',   label: 'Email verificado', done: !!u.verified },
  ];

  const done   = fields.filter(f => f.done).length;
  const total  = fields.length;
  const pct    = Math.round((done / total) * 100);

  document.getElementById('completion-pct').textContent  = pct + '%';
  document.getElementById('completion-fill').style.width = pct + '%';

  const tips = fields.filter(f => !f.done).slice(0, 2);
  const tipsEl = document.getElementById('completion-tips');
  if (tipsEl) {
    if (tips.length === 0) {
      tipsEl.innerHTML = `<span class="completion-tip done">✓ Perfil completo!</span>`;
    } else {
      tipsEl.innerHTML = tips.map(t =>
        `<span class="completion-tip">Adicionar: ${t.label}</span>`
      ).join('');
    }
  }

  // Update badges
  updateProfileBadges(pct);
}

function updateProfileBadges(pct) {
  if (!currentUser) return;
  const u = currentUser;
  const badges = [];

  const days = Math.max(1, Math.floor((Date.now() - new Date(u.joinedAt).getTime()) / 86400000) + 1);
  if (days >= 1)   badges.push({ icon: '🚀', label: 'Novo Membro' });
  if (days >= 7)   badges.push({ icon: '⭐', label: '1 Semana' });
  if (days >= 30)  badges.push({ icon: '🔥', label: '1 Mês' });
  if (pct >= 100)  badges.push({ icon: '💎', label: 'Perfil Completo' });
  if (u.avatar)    badges.push({ icon: '📸', label: 'Com Foto' });

  const container = document.getElementById('profile-badges');
  if (container) {
    container.innerHTML = badges.slice(0, 4).map(b =>
      `<div class="profile-badge" title="${b.label}">${b.icon} <span>${b.label}</span></div>`
    ).join('');
  }
}

// ─── ACTIVITY LOG ─────────────────────────────────
function getActivityLog() {
  const key = currentUser ? `evo_activity_${currentUser.username}` : null;
  if (!key) return [];
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch { return []; }
}

function saveActivityLog(log) {
  if (!currentUser) return;
  const key = `evo_activity_${currentUser.username}`;
  // Keep last 50 entries
  localStorage.setItem(key, JSON.stringify(log.slice(0, 50)));
}

function logActivity(type, label, detail = '') {
  if (!currentUser) return;
  const log = getActivityLog();
  const entry = {
    id: Date.now(),
    type,
    label,
    detail,
    time: new Date().toISOString(),
    device: getDeviceInfo()
  };
  log.unshift(entry);
  saveActivityLog(log);
  if (document.getElementById('tab-activity')?.classList.contains('active')) {
    renderActivityLog();
  }
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  if (/mobile/i.test(ua)) return 'Mobile';
  if (/tablet/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

function renderActivityLog() {
  if (!currentUser) return;
  const log = getActivityLog();
  const container = document.getElementById('activity-log');
  if (!container) return;

  // Update stats
  const loginCount  = log.filter(e => e.type === 'login').length;
  const actionCount = log.filter(e => e.type !== 'login').length;
  const days = Math.max(1, Math.floor((Date.now() - new Date(currentUser.joinedAt).getTime()) / 86400000) + 1);
  document.getElementById('astat-logins').textContent  = loginCount;
  document.getElementById('astat-actions').textContent = actionCount;
  document.getElementById('astat-days').textContent    = days;

  // Session info
  const sessionStart = sessionStorage.getItem('evo_session_start') || new Date().toISOString();
  const mins = Math.floor((Date.now() - new Date(sessionStart).getTime()) / 60000);
  document.getElementById('session-details').textContent =
    `${getDeviceInfo()} · Sessão iniciada há ${mins < 1 ? 'menos de 1 min' : mins + ' min'}`;

  if (log.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
      <p>Nenhuma atividade registrada</p>
    </div>`;
    return;
  }

  const typeIcons = {
    login:          `<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10,17 15,12 10,7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
    profile_update: `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    avatar_update:  `<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    password:       `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    settings:       `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  };

  container.innerHTML = log.map((e, i) => `
    <div class="activity-item" style="animation-delay:${i * 0.04}s">
      <div class="activity-icon">${typeIcons[e.type] || typeIcons.settings}</div>
      <div style="flex:1;min-width:0">
        <div class="activity-label">${escapeHtml(e.label)}</div>
        ${e.detail ? `<div class="activity-detail">${escapeHtml(e.detail)}</div>` : ''}
        <div class="activity-meta">${e.device} · ${new Date(e.time).toLocaleString('pt-BR', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <span class="activity-time">${timeAgo(e.time)}</span>
    </div>
  `).join('');
}

function clearActivityLog() {
  if (!currentUser) return;
  if (!confirm('Limpar todo o histórico de atividade local?')) return;
  localStorage.removeItem(`evo_activity_${currentUser.username}`);
  renderActivityLog();
  showToast('Histórico limpo');
}

async function exportAccountData() {
  if (!currentUser) return;
  const u = { ...currentUser };
  delete u.password;
  delete u.secAnswer;

  const notifs = await dbGet(`notifications/${currentUser.username}`) || {};
  const activity = getActivityLog();

  const exportObj = {
    exportedAt: new Date().toISOString(),
    account: u,
    notifications: Object.values(notifs),
    activityLog: activity
  };

  const json  = JSON.stringify(exportObj, null, 2);
  const blob  = new Blob([json], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = `evolution-data-${currentUser.username}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  logActivity('settings', 'Dados exportados');
  showToast('Dados exportados com sucesso!');
}

// ─── COMPACT MODE ─────────────────────────────────
function toggleCompactMode(enabled) {
  document.documentElement.setAttribute('data-compact', enabled ? 'true' : 'false');
  saveSetting('compactMode', enabled);
  logActivity('settings', enabled ? 'Modo compacto ativado' : 'Modo compacto desativado');
}

// ─── DEMO NOTIFICATIONS ───────────────────────────
window._seedDemoNotifs = async function() {
  if (!currentUser) return;
  const demo = [
    {
      id: 'notif_news_1',
      title: 'Evolution v2.0 chegando em breve',
      body: 'Novas funcionalidades de privacidade e performance. Fique ligado!',
      time: new Date(Date.now() - 3600000).toISOString(),
      read: false, type: 'news'
    },
    {
      id: 'notif_update_1',
      title: 'Perfil atualizado com sucesso',
      body: 'Suas informações foram salvas nos servidores Evolution.',
      time: new Date(Date.now() - 86400000).toISOString(),
      read: true, type: 'update'
    }
  ];
  for (const n of demo) {
    await dbSet(`notifications/${currentUser.username}/${n.id}`, n);
  }
  loadNotifications();
  showToast('Notificações demo carregadas!');
};