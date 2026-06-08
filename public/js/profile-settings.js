// ── Restore saved theme on every page load ───────────────────────────────────
(function restoreTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
})();

// ── Shared profile & settings logic ──────────────────────────────────────────
window._profileUser = null;

// ── initProfile ────────────────────────────────────────────────────────────
async function initProfile() {
  try {
    const user = await authAPI.getCurrentUser();
    window._profileUser = user;
    populateProfileForm(user);
    populateHeaderUser(user);
    loadPerformanceStats(user);
    setupAvatarUpload();
  } catch (e) {
    console.error('initProfile:', e.message);
  }
}

function populateProfileForm(user) {
  if (!user) return;

  // Header avatar / name
  const initials = (user.name || 'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const el = document.getElementById('profileAvatarInitials');
  if (el) {
    if (user.avatar) {
      // Show actual image instead of initials
      const avatarEl = document.getElementById('profileAvatarEl');
      if (avatarEl) {
        avatarEl.style.backgroundImage = `url(${user.avatar})`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        el.style.display = 'none';
      }
    } else {
      el.textContent = initials;
      el.style.display = '';
    }
  }

  setEl('profileDisplayName',  user.name);
  setEl('profileDisplayRole',  user.role?.charAt(0).toUpperCase() + user.role?.slice(1) || 'Agent');
  setEl('profileDisplayEmail', user.email);

  // Account meta
  setEl('metaUserId',  user._id || user.id || '—');
  setEl('metaRole',    user.role?.charAt(0).toUpperCase() + user.role?.slice(1) || '—');
  setEl('metaStatus',  user.status || 'active');
  setEl('metaCreated', user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—');
  setEl('metaJoined',  user.joinedAt  ? new Date(user.joinedAt).toLocaleDateString()  : (user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'));

  // Editable fields
  setInput('fieldName',        user.name       || '');
  setInput('fieldEmail',       user.email      || '');
  setInput('fieldPhone',       user.phone      || '');
  setInput('fieldDesignation', user.designation|| '');
  setInput('fieldDepartment',  user.department || '');
  setInput('fieldEmployeeId',  user.employeeId || '');
  setInput('fieldBio',         user.bio        || '');

  // Pending notice
  const banner = document.getElementById('pendingChangesBanner');
  if (banner) banner.style.display = user.pendingChanges ? 'block' : 'none';
}

// ── Avatar upload ─────────────────────────────────────────────────────────
function setupAvatarUpload() {
  const avatarEl = document.getElementById('profileAvatarEl');
  if (!avatarEl) return;

  // Create hidden file input
  let fileInput = document.getElementById('_avatarFileInput');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = '_avatarFileInput';
    fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }

  avatarEl.onclick = () => fileInput.click();

  fileInput.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be under 5MB.', 'error');
      return;
    }

    // Show a local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => {
      avatarEl.style.backgroundImage = `url(${ev.target.result})`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      const initEl = document.getElementById('profileAvatarInitials');
      if (initEl) initEl.style.display = 'none';
    };
    reader.readAsDataURL(file);

    // Upload to server
    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const token = getAuthToken();
      const resp = await fetch(`${typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'http://localhost:5000/api'}/auth/avatar`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await resp.text();
        throw new Error('Server error: ' + text.substring(0, 80));
      }

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || 'Upload failed');

      if (data.avatar) {
        avatarEl.style.backgroundImage = `url(${data.avatar})`;
        avatarEl.style.backgroundSize  = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        // Persist to localStorage so every page reads the updated avatar
        if (window._profileUser) window._profileUser.avatar = data.avatar;
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        stored.avatar = data.avatar;
        localStorage.setItem('user', JSON.stringify(stored));
        // Update header avatar on this page if it exists
        const hImg = document.getElementById('headerAvatarImg');
        if (hImg) { hImg.src = data.avatar; hImg.style.display = 'block'; }
        const hInit = document.getElementById('userInitials');
        if (hInit) hInit.style.display = 'none';
      }
      showToast('✅ Profile photo updated!', 'success');
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }

    // Reset so same file can be re-selected
    fileInput.value = '';
  };
}

async function loadPerformanceStats(user) {
  try {
    const data = await ticketAPI.getDashboardStats();
    // API returns { my: {open, inProgress, resolved}, total: {open, inProgress, resolved, all} }
    const my    = data?.my    || {};
    const total = data?.total || {};

    const assigned = (my.open ?? 0) + (my.inProgress ?? 0) + (my.resolved ?? 0);
    const resolved = my.resolved ?? 0;
    const open     = my.open     ?? 0;

    setEl('statAssigned', assigned || '—');
    setEl('statResolved', resolved || '—');
    setEl('statOpen',     open     || '—');
    setEl('perfAssigned', assigned || '—');
    setEl('perfResolved', resolved || '—');
    setEl('perfOpen',     open     || '—');
    setEl('perfAvgTime',  '—');
  } catch (e) {
    ['statAssigned','statResolved','statOpen',
     'perfAssigned','perfResolved','perfOpen','perfAvgTime'].forEach(id => setEl(id,'—'));
  }
}

// ── savePersonalDetails ───────────────────────────────────────────────────
async function savePersonalDetails() {
  const data = {
    name:        document.getElementById('fieldName')?.value?.trim(),
    phone:       document.getElementById('fieldPhone')?.value?.trim(),
    designation: document.getElementById('fieldDesignation')?.value?.trim(),
    department:  document.getElementById('fieldDepartment')?.value?.trim(),
    employeeId:  document.getElementById('fieldEmployeeId')?.value?.trim(),
    bio:         document.getElementById('fieldBio')?.value?.trim()
  };

  if (!data.name) { showMsg('profileSaveMsg','Name is required.','error'); return; }

  const btn  = document.getElementById('savePersonalBtn') || document.getElementById('saveProfileBtn');
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    const res = await authAPI.updateProfile(data);
    window._profileUser = res.user;
    populateHeaderUser(res.user);
    setEl('profileDisplayName', res.user.name);

    const init = (res.user.name||'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const ael = document.getElementById('profileAvatarInitials');
    if (ael && !res.user.avatar) ael.textContent = init;

    showMsg('profileSaveMsg','✅ Profile saved successfully!','success');
    showToast('Profile updated.','success');
  } catch (err) {
    showMsg('profileSaveMsg','❌ ' + err.message,'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig || 'Save'; }
  }
}

// ── initSettings ──────────────────────────────────────────────────────────
async function initSettings() {
  try {
    const user = await authAPI.getCurrentUser();
    window._profileUser = user;
    populateHeaderUser(user);
    applyPrefs(user);
    loadLoginActivity();
    checkGmailStatus();
    // availability — map legacy 'online' to 'active'
    const rawStatus = user.status || user.pref_availability || 'active';
    const mappedStatus = rawStatus === 'online' ? 'active' : rawStatus;
    setAvailabilityUI(mappedStatus);
  } catch (e) { console.error('initSettings:', e.message); }
}

function applyPrefs(user) {
  const prefs = [
    'notif_new_ticket','notif_customer_reply','notif_assignment','notif_email','notif_browser',
    'pref_theme','pref_compact','pref_language','pref_timezone',
    'pref_signature','pref_default_view','pref_default_filter','pref_per_page','pref_sort_order'
  ];
  prefs.forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    const val = user[key];
    if (el.type === 'checkbox') {
      // Default notification toggles to true if user has never set them
      el.checked = val !== undefined ? !!val : key.startsWith('notif_');
    } else if (el.tagName === 'SELECT') el.value = val || '';
    else el.value = val || '';
  });

  // live signature preview
  const sigVal = user.pref_signature || '';
  const preview = document.getElementById('signaturePreviewText');
  if (preview) preview.textContent = sigVal;

  // theme
  applyTheme(user.pref_theme || 'light');
  // compact
  if (user.pref_compact) document.body.classList.add('compact');
}

// ── savePref ──────────────────────────────────────────────────────────────
let _prefDebounce = null;
function savePref(key, value) {
  clearTimeout(_prefDebounce);
  _prefDebounce = setTimeout(async () => {
    try {
      await authAPI.updatePreferences({ [key]: value });
      showToast('Preference saved.', 'success');
    } catch (e) {
      showToast('Failed to save: ' + e.message, 'error');
    }
  }, 600);
}

// ── Load login activity ───────────────────────────────────────────────────
async function loadLoginActivity() {
  const el = document.getElementById('loginActivityList');
  if (!el) return;
  try {
    const res = await authAPI.getLoginActivity();
    const list = res.loginActivity || [];

    if (!list.length) {
      el.innerHTML = `<div class="activity-log-item">
        <div class="log-icon">📭</div>
        <div class="log-info"><div class="log-device">No login history recorded yet.</div></div>
      </div>`;
      return;
    }

    el.innerHTML = list.slice(0,10).map(item => `
      <div class="activity-log-item">
        <div class="log-icon">🖥️</div>
        <div class="log-info">
          <div class="log-device">${esc(item.ua || 'Unknown browser')}</div>
          <div class="log-meta">IP: ${esc(item.ip || '—')}</div>
        </div>
        <div class="log-time">${item.ts ? new Date(item.ts).toLocaleString() : '—'}</div>
      </div>`).join('');
  } catch (e) {
    el.innerHTML = `<div class="activity-log-item"><div class="log-icon">📭</div><div class="log-info"><div class="log-device">Login history not available.</div></div></div>`;
  }
}

// ── Check Gmail status ────────────────────────────────────────────────────
async function checkGmailStatus() {
  const el = document.getElementById('gmailStatus');
  if (!el) return;
  try {
    await apiCall('/gmail/status', 'GET');
    el.innerHTML = `<span class="int-dot connected"></span><span style="color:var(--success-dark);font-weight:600;">Connected</span>`;
  } catch (_) {
    el.innerHTML = `<span class="int-dot disconnected"></span><span style="color:var(--text-secondary);">Not configured</span>`;
  }
}

function setAvailabilityUI(status) {
  document.querySelectorAll('.status-pill').forEach(p => {
    p.classList.toggle('selected', p.dataset.status === status);
  });
  const lbl = document.getElementById('availLabel');
  const labels = { active: 'Active', busy: 'Busy', away: 'Away' };
  if (lbl) lbl.textContent = labels[status] || status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Shared header user init ───────────────────────────────────────────────
function populateHeaderUser(user) {
  const initials = (user.name||'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const nel      = document.getElementById('userName');
  const initialsEl = document.getElementById('userInitials');
  const imgEl    = document.getElementById('headerAvatarImg');

  if (nel) nel.textContent = user.name || 'User';

  if (user.avatar) {
    // Show photo via the <img> element inside .avatar-header
    if (imgEl) {
      imgEl.src = user.avatar;
      imgEl.style.display = 'block';
    }
    if (initialsEl) initialsEl.style.display = 'none';
  } else {
    // No photo — show initials text
    if (imgEl) imgEl.style.display = 'none';
    if (initialsEl) {
      initialsEl.style.display = '';
      initialsEl.textContent   = initials;
    }
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let c = document.getElementById('_toastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id = '_toastContainer';
    c.style.cssText = 'position:fixed;bottom:22px;right:22px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:320px;';
    document.body.appendChild(c);
  }
  const colors = { success:'#10B981', error:'#EF4444', warning:'#F59E0B', info:'#3B82F6' };
  const t = document.createElement('div');
  t.style.cssText = `background:${colors[type]||colors.info};color:#fff;padding:11px 16px;border-radius:8px;font-size:13.5px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,.15);animation:slideIn .3s ease;`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; }, 3200);
  setTimeout(() => t.remove(), 3700);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}
function setInput(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function showMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = type === 'success' ? 'var(--success-dark)' : 'var(--danger)';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Apply theme globally ──────────────────────────────────────────────────
function applyTheme(val) {
  if (val === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('theme', val || 'light');
}

