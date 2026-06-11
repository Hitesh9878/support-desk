let currentUser   = null;
let currentStatus = 'active';
let pendingDeleteId = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!getAuthToken()) { window.location.href = '/login.html'; return; }

  try {
    currentUser = await authAPI.getCurrentUser();
    localStorage.setItem('user', JSON.stringify(currentUser));
  } catch (_) {
    currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  }

  document.getElementById('userName').textContent = currentUser.name || 'User';
  // ── Header avatar: show photo if available, else initials ─────────────────
  const initials = (currentUser.name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('userInitials').textContent = initials;
  if (currentUser.avatar) {
    const img = document.getElementById('headerAvatarImg');
    if (img) {
      img.src = currentUser.avatar;
      img.style.display = 'block';
      document.getElementById('userInitials').style.display = 'none';
    }
  }

  currentStatus = currentUser.status || 'active';
  updateStatusUI();

  await loadDashboardData();

  // Show admin-only UI
  if (currentUser.role === 'admin') {
    document.getElementById('teamSection').style.display = '';
    document.getElementById('pendingApprovalsSection').style.display = '';
    document.getElementById('inviteAgentHeaderBtn').style.display = '';
    await loadTeamMembers();
    await loadPendingApprovals();
  }

  setupEventListeners();
});

// ─── Load dashboard data ──────────────────────────────────────────────────────
async function loadDashboardData() {
  try {
    const stats = await ticketAPI.getDashboardStats();

    // My tickets panel
    document.getElementById('myOpen').textContent       = stats.my.open;
    document.getElementById('myInProgress').textContent = stats.my.inProgress;
    document.getElementById('myResolved').textContent   = stats.my.resolved;

    // Total tickets panel
    document.getElementById('totalOpen').textContent       = stats.total.open;
    document.getElementById('totalInProgress').textContent = stats.total.inProgress;
    document.getElementById('totalResolved').textContent   = stats.total.resolved;

    // Bottom stat cards — need extra counts
    document.getElementById('allTickets').textContent    = stats.total.all;
    document.getElementById('totalCustomers').textContent = stats.customerCount;

    // Unassigned + urgent — fetch separately (lightweight)
    const [unassignedData, urgentData] = await Promise.all([
      ticketAPI.getAll({ unassigned: 'true', limit: 1, page: 1 }),
      ticketAPI.getAll({ priority: 'urgent', limit: 1, page: 1 })
    ]);
    document.getElementById('unassignedCount').textContent = unassignedData.total || 0;
    document.getElementById('urgentCount').textContent     = urgentData.total || 0;

    // Recent tickets
    displayRecentTickets(stats.recentTickets, currentUser.role === 'admin');
  } catch (err) {
    console.error('loadDashboardData:', err.message);
  }
}

// ─── Recent tickets list ──────────────────────────────────────────────────────
function displayRecentTickets(tickets, isAdmin) {
  const list = document.getElementById('recentTicketsList');
  if (!tickets || tickets.length === 0) {
    list.innerHTML = '<p class="empty">No tickets yet</p>';
    return;
  }

  list.innerHTML = tickets.map(t => `
    <div class="ticket-row" style="cursor:pointer;" onclick="window.location='/tickets.html'">
      <div class="ticket-header">
        <span class="ticket-number">${esc(t.ticketNumber)}</span>
        <span class="ticket-subject">${esc(t.subject)}</span>
        <div class="ticket-row-actions">
          ${isAdmin ? `
            <button class="btn-delete-ticket"
              style="display:inline-block;"
              onclick="event.stopPropagation(); openDeleteConfirm('${t._id}','${esc(t.ticketNumber)}','${esc(t.subject).replace(/'/g,'')}')">
              🗑 Delete
            </button>` : ''}
        </div>
      </div>
      <div class="ticket-meta">
        <span>${esc(t.customer?.name || 'Unknown')}</span>
        <span class="priority priority-${t.priority}">${t.priority}</span>
        <span class="status status-${t.status}">${t.status}</span>
        <span style="font-size:11px;color:var(--text-secondary);margin-left:auto;">
          ${t.assignedAgent ? '👤 ' + esc(t.assignedAgent.name) : '— Unassigned'}
        </span>
      </div>
    </div>`).join('');
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function openDeleteConfirm(id, number, subject) {
  pendingDeleteId = id;
  document.getElementById('deleteTicketLabel').textContent = `${number} — ${subject}`;
  document.getElementById('deleteConfirmModal').classList.add('active');
}

document.getElementById('confirmDeleteBtn')?.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('confirmDeleteBtn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await ticketAPI.delete(pendingDeleteId);
    document.getElementById('deleteConfirmModal').classList.remove('active');
    pendingDeleteId = null;
    await loadDashboardData();
    showToast('Ticket deleted successfully.', 'success');
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Yes, Delete';
  }
});

// ─── Event listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('refreshDashboardBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshDashboardBtn');
    btn.disabled = true; btn.textContent = '🔄 Refreshing…';
    await loadDashboardData();
    if (currentUser.role === 'admin') {
      await loadPendingApprovals();
      await loadTeamMembers();
    }
    btn.disabled = false; btn.textContent = '🔄 Refresh';
  });

  document.getElementById('statusBtn').addEventListener('click', () => {
    const list = ['active', 'busy', 'inactive'];
    currentStatus = list[(list.indexOf(currentStatus) + 1) % list.length];
    authAPI.updateStatus(currentStatus).then(() => {
      currentUser.status = currentStatus;
      localStorage.setItem('user', JSON.stringify(currentUser));
      updateStatusUI();
    });
  });

  document.getElementById('userBtn').addEventListener('click', () => {
    document.getElementById('userDropdown').classList.toggle('active');
  });

  document.getElementById('logoutBtn').addEventListener('click', e => {
    e.preventDefault();
    clearAuthToken(); localStorage.removeItem('user');
    window.location.href = '/login.html';
  });

  // Modals
  const newTicketModal   = document.getElementById('newTicketModal');
  const newCustomerModal = document.getElementById('newCustomerModal');

  document.getElementById('newTicketBtn').addEventListener('click', async () => {
    await loadCustomersForSelect(); newTicketModal.classList.add('active');
  });
  document.getElementById('newCustomerBtn').addEventListener('click', () => {
    newCustomerModal.classList.add('active');
  });
  document.getElementById('cancelTicketBtn').addEventListener('click', () => {
    newTicketModal.classList.remove('active');
  });
  document.getElementById('cancelCustomerBtn').addEventListener('click', () => {
    newCustomerModal.classList.remove('active');
  });

  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.target.closest('.modal').classList.remove('active'); });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  });

  document.getElementById('newTicketForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await ticketAPI.create(
        document.getElementById('ticketSubject').value,
        document.getElementById('ticketDescription').value,
        document.getElementById('ticketCustomer').value,
        document.getElementById('ticketPriority').value
      );
      newTicketModal.classList.remove('active');
      document.getElementById('newTicketForm').reset();
      await loadDashboardData();
      showToast('Ticket created!', 'success');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  document.getElementById('newCustomerForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await customerAPI.create(
        document.getElementById('customerName').value,
        document.getElementById('customerEmail').value,
        document.getElementById('customerPhone').value,
        document.getElementById('customerCompany').value
      );
      newCustomerModal.classList.remove('active');
      document.getElementById('newCustomerForm').reset();
      await loadDashboardData();
      showToast('Customer created!', 'success');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });
}

async function loadCustomersForSelect() {
  try {
    const data = await customerAPI.getAll(1, 200);
    document.getElementById('ticketCustomer').innerHTML =
      data.customers.map(c => `<option value="${c._id}">${esc(c.name)} (${esc(c.email)})</option>`).join('');
  } catch (_) {}
}

function updateStatusUI() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const map   = { active: { color: '#22c55e', text: 'Active' }, busy: { color: '#f59e0b', text: 'Busy' }, inactive: { color: '#9ca3af', text: 'Away' } };
  const s     = map[currentStatus] || map.active;
  dot.style.background = s.color;
  label.textContent    = s.text;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let c = document.getElementById('toastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toastContainer';
    c.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(c);
  }
  const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
  const t = document.createElement('div');
  t.style.cssText = `background:${colors[type]};color:#fff;padding:12px 20px;border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,.2);font-size:14px;max-width:320px;`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3500);
  setTimeout(() => t.remove(), 4000);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Team management ──────────────────────────────────────────────────────────
async function loadTeamMembers() {
  const container = document.getElementById('teamMembersList');
  if (!container) return;
  try {
    const members = await authAPI.getTeamMembers();
    if (!members.length) {
      container.innerHTML = '<p class="empty">No team members yet. Invite your first agent!</p>';
      return;
    }

    const statusBadge = s => {
      const map = {
        active:   'background:#dcfce7;color:#15803d',
        busy:     'background:#fef9c3;color:#854d0e',
        inactive: 'background:#f3f4f6;color:#6b7280',
        invited:  'background:#ede9fe;color:#5b21b6'
      };
      return `<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;${map[s]||map.inactive};text-transform:capitalize;">${s}</span>`;
    };

    const roleBadge = r =>
      `<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;background:#e0e7ff;color:#3730a3;text-transform:capitalize;">${r}</span>`;

    container.innerHTML = `
      <div class="team-table-wrap">
        <table class="team-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${members.map(m => `
              <tr>
                <td style="font-weight:600;">${esc(m.name)}</td>
                <td style="color:var(--text-secondary);font-size:13px;">${esc(m.email)}</td>
                <td>${roleBadge(m.role)}</td>
                <td>${statusBadge(m.status)}</td>
                <td style="font-size:12px;color:var(--text-secondary);">
                  ${m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : m.status === 'invited' ? '⏳ Pending' : '—'}
                </td>
                <td>
                  <div style="display:flex;gap:6px;">
                    ${m.status === 'invited' ? `
                      <button class="btn-small" style="background:var(--indigo-50);color:var(--indigo-700);border:1px solid var(--indigo-200);"
                        onclick="resendInvite('${m._id}', '${esc(m.name)}')">
                        🔄 Resend
                      </button>` : ''}
                    <button class="btn-small" style="background:var(--danger-light);color:var(--danger-text);border:1px solid #fca5a5;"
                      onclick="removeMember('${m._id}', '${esc(m.name)}')">
                      🗑 Remove
                    </button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="team-cards-mobile">
        ${members.map(m => `
          <div class="team-card">
            <div class="team-card-row">
              <span class="team-card-label">NAME</span>
              <span class="team-card-val team-card-name">${esc(m.name)}</span>
            </div>
            <div class="team-card-row">
              <span class="team-card-label">EMAIL</span>
              <span class="team-card-val team-card-email">${esc(m.email)}</span>
            </div>
            <div class="team-card-row">
              <span class="team-card-label">ROLE</span>
              <span class="team-card-val">${roleBadge(m.role)}</span>
            </div>
            <div class="team-card-row">
              <span class="team-card-label">STATUS</span>
              <span class="team-card-val">${statusBadge(m.status)}</span>
            </div>
            <div class="team-card-row">
              <span class="team-card-label">JOINED</span>
              <span class="team-card-val" style="font-size:12px;color:var(--text-secondary);">
                ${m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : m.status === 'invited' ? '⏳ Pending' : '—'}
              </span>
            </div>
            <div class="team-card-actions">
              ${m.status === 'invited' ? `
                <button class="btn-small" style="background:var(--indigo-50);color:var(--indigo-700);border:1px solid var(--indigo-200);"
                  onclick="resendInvite('${m._id}', '${esc(m.name)}')">
                  🔄 Resend Invite
                </button>` : ''}
              <button class="btn-small" style="background:var(--danger-light);color:var(--danger-text);border:1px solid #fca5a5;"
                onclick="removeMember('${m._id}', '${esc(m.name)}')">
                🗑 Remove
              </button>
            </div>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = `<p class="empty">Error loading team: ${esc(err.message)}</p>`;
  }
}

async function resendInvite(id, name) {
  if (!confirm(`Resend invite to ${name}?`)) return;
  try {
    const res = await authAPI.resendInvite(id);
    showToast(`✉️ Invite resent to ${name}`, 'success');
    await loadTeamMembers();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function removeMember(id, name) {
  if (!confirm(`Remove ${name} from the team? This cannot be undone.`)) return;
  try {
    await authAPI.deleteTeamMember(id);
    showToast(`${name} removed from team.`, 'success');
    await loadTeamMembers();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ─── Invite modal wiring ──────────────────────────────────────────────────────
function openInviteModal() {
  document.getElementById('inviteName').value    = '';
  document.getElementById('inviteEmail').value   = '';
  document.getElementById('inviteRole').value    = 'agent';
  document.getElementById('inviteError').style.display   = 'none';
  document.getElementById('inviteSuccess').style.display = 'none';
  document.getElementById('sendInviteBtn').disabled      = false;
  document.getElementById('sendInviteBtn').textContent   = 'Send Invite Email';
  document.getElementById('inviteAgentModal').classList.add('active');
}

document.getElementById('inviteAgentBtn')?.addEventListener('click', openInviteModal);
document.getElementById('inviteAgentHeaderBtn')?.addEventListener('click', openInviteModal);
document.getElementById('cancelInviteBtn')?.addEventListener('click', () => {
  document.getElementById('inviteAgentModal').classList.remove('active');
});
document.getElementById('closeInviteBtn')?.addEventListener('click', () => {
  document.getElementById('inviteAgentModal').classList.remove('active');
});

document.getElementById('sendInviteBtn')?.addEventListener('click', async () => {
  const name  = document.getElementById('inviteName').value.trim();
  const email = document.getElementById('inviteEmail').value.trim();
  const role  = document.getElementById('inviteRole').value;
  const errEl = document.getElementById('inviteError');
  const sucEl = document.getElementById('inviteSuccess');
  const btn   = document.getElementById('sendInviteBtn');

  errEl.style.display = 'none';
  sucEl.style.display = 'none';

  if (!name || !email) { errEl.textContent = 'Name and email are required.'; errEl.style.display = 'block'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'Please enter a valid email address.'; errEl.style.display = 'block'; return; }

  btn.disabled = true; btn.textContent = 'Sending…';

  try {
    const res = await authAPI.inviteAgent(name, email, role);
    sucEl.textContent   = `✅ Invite sent to ${email}! They'll receive an email to set their password.`;
    sucEl.style.display = 'block';
    btn.textContent     = 'Sent!';
    await loadTeamMembers();

    // Auto-close after 2.5s
    setTimeout(() => {
      document.getElementById('inviteAgentModal').classList.remove('active');
    }, 2500);
  } catch (err) {
    errEl.textContent   = err.message || 'Failed to send invite.';
    errEl.style.display = 'block';
    btn.disabled        = false;
    btn.textContent     = 'Send Invite Email';
  }
});

// Close invite modal on outside click
document.getElementById('inviteAgentModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('inviteAgentModal'))
    document.getElementById('inviteAgentModal').classList.remove('active');
});

// ─── Pending Approvals ────────────────────────────────────────────────────────
async function loadPendingApprovals() {
  const container = document.getElementById('pendingApprovalsList');
  const badge     = document.getElementById('pendingBadge');
  if (!container) return;

  try {
    const data = await authAPI.getPendingApprovals();
    const regs  = data.pendingRegistrations  || [];
    const profs = data.pendingProfileChanges || [];
    const total = regs.length + profs.length;

    if (badge) {
      badge.style.display = total > 0 ? 'inline' : 'none';
      badge.textContent   = total;
    }

    const pwReset = data.pendingPasswordResets || [];
    const total2  = regs.length + profs.length + pwReset.length;

    if (badge) {
      badge.style.display = total2 > 0 ? 'inline' : 'none';
      badge.textContent   = total2;
    }

    if (total2 === 0) {
      container.innerHTML = '<p class="empty">No pending approvals ✅</p>';
      return;
    }

    let html = '';

    if (regs.length > 0) {
      html += `<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;
                letter-spacing:.07em;padding:10px 0 6px;">New Registrations (${regs.length})</div>`;
      html += regs.map(u => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;
          border:1.5px solid #fde68a;border-radius:var(--radius-md);background:#fffbeb;margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13.5px;">${esc(u.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${esc(u.email)} · ${esc(u.role)}</div>
            <div style="font-size:11px;color:var(--text-secondary);">Registered ${new Date(u.createdAt).toLocaleString()}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-sm" style="background:#dcfce7;color:#15803d;border:1px solid #86efac;"
              onclick="approveRegistration('${u._id}','${esc(u.name)}')">✅ Approve</button>
            <button class="btn btn-sm" style="background:var(--danger-light);color:var(--danger-text);border:1px solid #fca5a5;"
              onclick="rejectRegistration('${u._id}','${esc(u.name)}')">❌ Reject</button>
          </div>
        </div>`).join('');
    }

    if (profs.length > 0) {
      html += `<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;
                letter-spacing:.07em;padding:${regs.length>0?'14px':10}px 0 6px;">Profile Change Requests (${profs.length})</div>`;
      html += profs.map(u => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;
          border:1.5px solid #bfdbfe;border-radius:var(--radius-md);background:#eff6ff;margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13.5px;">${esc(u.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">${esc(u.email)} · requested ${new Date(u.pendingChangesAt).toLocaleString()}</div>
            <div style="font-size:12px;background:#fff;border:1px solid #dbeafe;border-radius:6px;padding:8px 10px;">
              ${Object.entries(u.pendingChanges||{}).map(([k,v]) =>
                `<div><span style="color:var(--text-secondary);">${k}:</span> <strong>${esc(String(v))}</strong></div>`
              ).join('')}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
            <button class="btn btn-sm" style="background:#dcfce7;color:#15803d;border:1px solid #86efac;"
              onclick="approveProfileChange('${u._id}','${esc(u.name)}')">✅ Approve</button>
            <button class="btn btn-sm" style="background:var(--danger-light);color:var(--danger-text);border:1px solid #fca5a5;"
              onclick="rejectProfileChange('${u._id}','${esc(u.name)}')">❌ Reject</button>
          </div>
        </div>`).join('');
    }

    if (pwReset.length > 0) {
      html += `<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;
                letter-spacing:.07em;padding:14px 0 6px;">Password Reset Requests (${pwReset.length})</div>`;
      html += pwReset.map(u => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;
          border:1.5px solid #d8b4fe;border-radius:var(--radius-md);background:#faf5ff;margin-bottom:8px;">
          <div style="font-size:22px;">🔐</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13.5px;">${esc(u.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${esc(u.email)} · ${esc(u.role)}</div>
            <div style="font-size:11px;color:var(--text-secondary);">
              Requested ${new Date(u.pendingPasswordReset?.requestedAt).toLocaleString()}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-sm" style="background:#dcfce7;color:#15803d;border:1px solid #86efac;"
              onclick="approvePasswordReset('${u._id}','${esc(u.name)}')">✅ Approve</button>
            <button class="btn btn-sm" style="background:var(--danger-light);color:var(--danger-text);border:1px solid #fca5a5;"
              onclick="rejectPasswordReset('${u._id}','${esc(u.name)}')">❌ Reject</button>
          </div>
        </div>`).join('');
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="empty">Error: ${esc(err.message)}</p>`;
  }
}

async function approveRegistration(id, name) {
  try {
    await authAPI.approveRegistration(id);
    showToast(`✅ ${name}'s account approved — they can now log in.`, 'success');
    await loadPendingApprovals();
    await loadDashboardData();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function rejectRegistration(id, name) {
  if (!confirm(`Reject and remove ${name}'s registration?`)) return;
  try {
    await authAPI.rejectRegistration(id);
    showToast(`${name}'s registration rejected and removed.`, 'info');
    await loadPendingApprovals();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function approveProfileChange(id, name) {
  try {
    await authAPI.approveProfileChange(id);
    showToast(`✅ ${name}'s profile changes approved and applied.`, 'success');
    await loadPendingApprovals();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function rejectProfileChange(id, name) {
  try {
    await authAPI.rejectProfileChange(id);
    showToast(`${name}'s profile changes rejected.`, 'info');
    await loadPendingApprovals();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function approvePasswordReset(id, name) {
  try {
    await authAPI.approvePasswordReset(id);
    showToast(`✅ Password reset approved for ${name}. They can now log in.`, 'success');
    await loadPendingApprovals();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function rejectPasswordReset(id, name) {
  if (!confirm(`Reject password reset request from ${name}?`)) return;
  try {
    await authAPI.rejectPasswordReset(id);
    showToast(`Password reset rejected for ${name}.`, 'info');
    await loadPendingApprovals();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}