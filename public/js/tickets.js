// ─── State ────────────────────────────────────────────────────────────────────
let currentPage     = 1;
let currentTicketId = null;
let currentBin      = 'all';
let currentUserId   = null;
let currentUserRole = null;
let agentList       = [];
let autoAssignIndex = 0;
const PER_PAGE      = 10;

// ── Notification sound (Web Audio, no file needed) ──
let audioCtx = null;
function playAssignSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) { /* browser may block until user gesture */ }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!getAuthToken()) { window.location.href = '/login.html'; return; }

  try {
    const me = await authAPI.getCurrentUser();
    currentUserId   = me._id || me.id;
    currentUserRole = me.role;
    // Update header avatar + apply theme
    if (typeof populateHeaderUser === 'function') populateHeaderUser(me);
    if (typeof applyTheme === 'function') applyTheme(me.pref_theme || localStorage.getItem('theme') || 'light');
    // Inject signature into reply box
    const sig = me.pref_signature || '';
    const sigBar  = document.getElementById('replySignatureBar');
    const sigText = document.getElementById('replySignatureText');
    if (sigBar && sigText && sig) {
      sigText.textContent = sig;
      sigBar.style.display = 'block';
    }
    // Hide signature when internal note is ticked
    document.getElementById('isInternalNote')?.addEventListener('change', e => {
      if (sigBar) sigBar.style.display = e.target.checked ? 'none' : (sig ? 'block' : 'none');
    });
    // Hide auto-assign button for non-admins
    const autoBtn = document.getElementById('autoAssignBtn');
    if (autoBtn && me.role !== 'admin') autoBtn.style.display = 'none';
    // Hide per-ticket auto-assign too
    const perBtn = document.getElementById('perTicketAutoAssign');
    if (perBtn && me.role !== 'admin') perBtn.style.display = 'none';
  } catch(e) { console.warn('Could not get current user', e.message); }

  await loadAgents();
  await loadTickets();
  await refreshTabCounts();
  setupEventListeners();
  setupSocketIO();
});

// ─── Agents ───────────────────────────────────────────────────────────────────
async function loadAgents() {
  try {
    agentList = await apiCall('/auth/agents', 'GET') || [];
  } catch(e) { agentList = []; }
  populateAgentSelect(document.getElementById('ticketAssignedAgent'));
}

function populateAgentSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">Unassigned</option>';
  agentList.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a._id;
    opt.textContent = a.name + (a.status === 'active' ? '' : ' (inactive)');
    sel.appendChild(opt);
  });
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
function setupSocketIO() {
  if (typeof io === 'undefined') return;
  const socket = io();

  socket.on('ticket:created', ticket => {
    showToast(`📧 New ticket: ${ticket.subject}`, 'info');
    loadTickets(); refreshTabCounts();
  });

  socket.on('ticket:updated', ticket => {
    loadTickets(); refreshTabCounts();
    const assignedId = ticket.assignedAgent?._id || ticket.assignedAgent;
    if (assignedId && assignedId === currentUserId) {
      playAssignSound();
      showToast(`🔔 Ticket ${ticket.ticketNumber} assigned to you!`, 'info');
    }
  });

  socket.on('ticket:deleted', ({ ticketId }) => {
    loadTickets(); refreshTabCounts();
    if (ticketId === currentTicketId) {
      document.getElementById('ticketDetailModal')?.classList.remove('active');
      currentTicketId = null;
      showToast('This ticket has been deleted.', 'warning');
    }
  });

  socket.on('message:added', ({ ticketId, message }) => {
    const tid = ticketId?.toString?.() || ticketId;
    if (tid === currentTicketId) appendMessage(message);
    loadTickets();
  });
}

// ─── Event listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('applyFiltersBtn')?.addEventListener('click', () => { currentPage=1; loadTickets(); });

  document.getElementById('refreshTicketsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshTicketsBtn');
    btn.disabled = true; btn.textContent = '🔄 Refreshing…';
    await loadTickets(); await refreshTabCounts();
    btn.disabled = false; btn.textContent = '🔄 Refresh';
  });
  document.getElementById('newTicketBtn')?.addEventListener('click', () => { window.location.href='/dashboard.html#newTicket'; });

  document.getElementById('modalCloseBtn')?.addEventListener('click', () => {
    document.getElementById('ticketDetailModal').classList.remove('active');
    currentTicketId = null;
  });

  document.getElementById('sendReplyBtn')?.addEventListener('click', sendEmailReply);
  document.getElementById('replyBody')?.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') sendEmailReply(); });

  // ── File attachment wiring ──────────────────────────────────────────────────
  const attachmentInput = document.getElementById('attachmentInput');
  if (attachmentInput) {
    attachmentInput.addEventListener('change', handleFileSelect);
  }

  // ── Clipboard paste (Ctrl+V) — paste images directly into reply box ─────────
  const replyBody = document.getElementById('replyBody');
  if (replyBody) {
    replyBody.addEventListener('paste', handlePaste);

    // ── Drag & drop onto reply textarea ────────────────────────────────────────
    replyBody.addEventListener('dragover', e => {
      e.preventDefault();
      replyBody.classList.add('drag-over');
    });
    replyBody.addEventListener('dragleave', () => replyBody.classList.remove('drag-over'));
    replyBody.addEventListener('drop', e => {
      e.preventDefault();
      replyBody.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) {
        pendingAttachments = [...pendingAttachments, ...files];
        updateAttachmentsPreview();
      }
    });
  }

  document.getElementById('ticketStatus')?.addEventListener('change', e => updateTicket({ status: e.target.value }));
  document.getElementById('ticketPriority')?.addEventListener('change', e => updateTicket({ priority: e.target.value }));
  document.getElementById('ticketAssignedAgent')?.addEventListener('change', async e => {
    const newId = e.target.value;
    await updateTicket({ assignedAgent: newId || null });
    if (newId && newId === currentUserId) playAssignSound();
  });

  // Bin tabs
  document.querySelectorAll('.ticket-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ticket-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentBin = tab.dataset.bin; currentPage = 1;
      loadTickets();
    });
  });

  // Conversation tabs inside modal
  document.querySelectorAll('.conv-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.conv-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.conv-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.panel}`)?.classList.add('active');
    });
  });

  // Auto-assign all
  document.getElementById('autoAssignBtn')?.addEventListener('click', autoAssignAll);

  // Per-ticket auto-assign (next active agent)
  document.getElementById('perTicketAutoAssign')?.addEventListener('click', async () => {
    const active = agentList.filter(a => a.status === 'active');
    if (!active.length) { showToast('No active agents available.', 'warning'); return; }
    const agent = active[autoAssignIndex % active.length];
    autoAssignIndex++;
    const sel = document.getElementById('ticketAssignedAgent');
    if (sel) sel.value = agent._id;
    await updateTicket({ assignedAgent: agent._id });
    if (agent._id === currentUserId) playAssignSound();
    showToast(`✅ Assigned to ${agent.name}`, 'success');
  });
}

// ─── Load tickets ─────────────────────────────────────────────────────────────
async function loadTickets() {
  const status   = document.getElementById('statusFilter')?.value;
  const priority = document.getElementById('priorityFilter')?.value;
  const search   = document.getElementById('searchFilter')?.value;
  const filters  = { page: currentPage, limit: PER_PAGE };
  if (status)   filters.status   = status;
  if (priority) filters.priority = priority;
  if (search)   filters.search   = search;
  if (currentBin === 'mine' && currentUserId) filters.assignedAgent = currentUserId;
  if (currentBin === 'unassigned') filters.unassigned = 'true';

  try {
    const data = await ticketAPI.getAll(filters);
    displayTickets(data.tickets);
    displayPagination(data.totalPages);
    const el = document.getElementById('ticketCount');
    if (el) el.textContent = `— ${data.total} ticket${data.total!==1?'s':''}`;
  } catch(e) { console.error('loadTickets:', e.message); }
}

async function refreshTabCounts() {
  try {
    const [all, mine, unassigned] = await Promise.all([
      ticketAPI.getAll({ limit:1, page:1 }),
      currentUserId ? ticketAPI.getAll({ limit:1, page:1, assignedAgent: currentUserId }) : {total:0},
      ticketAPI.getAll({ limit:1, page:1, unassigned:'true' })
    ]);
    document.getElementById('count-all').textContent        = all.total       ?? 0;
    document.getElementById('count-mine').textContent       = mine.total      ?? 0;
    document.getElementById('count-unassigned').textContent = unassigned.total ?? 0;
  } catch(e) {}
}

function displayTickets(tickets) {
  const tbody = document.getElementById('ticketsTableBody');
  if (!tickets?.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No tickets found</td></tr>';
    return;
  }
  tbody.innerHTML = tickets.map(t => {
    const icon = t.channel === 'email' ? '📧' : t.channel === 'web' ? '🌐' : '📞';
    return `<tr onclick="openTicketDetail('${t._id}')" style="cursor:pointer;">
      <td><strong>${t.ticketNumber}</strong></td>
      <td>${icon} ${esc(t.subject)}</td>
      <td>${esc(t.customer?.name || 'Unknown')}</td>
      <td><span class="status status-${t.status}">${t.status}</span></td>
      <td><span class="priority priority-${t.priority}">${t.priority}</span></td>
      <td>${esc(t.assignedAgent?.name || 'Unassigned')}</td>
      <td>${new Date(t.createdAt).toLocaleDateString()}</td>
      <td style="white-space:nowrap;">
        <div style="display:flex;gap:6px;justify-content:center;align-items:center;">
          <button class="btn-small btn-view-ticket"
            onclick="openTicketDetail('${t._id}');event.stopPropagation();">
            👁 View
          </button>
          ${currentUserRole === 'admin' ? `
          <button class="btn-delete-row"
            onclick="event.stopPropagation();deleteTicket('${t._id}','${t.ticketNumber}')"
            title="Delete ticket">
            🗑 Delete
          </button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function displayPagination(totalPages) {
  const c = document.getElementById('paginationContainer');
  if (!c || totalPages <= 1) { if(c) c.innerHTML=''; return; }
  let html = '';
  for (let i=1; i<=totalPages; i++)
    html += `<button class="page-btn ${i===currentPage?'active':''}" onclick="goToPage(${i})">${i}</button>`;
  c.innerHTML = html;
}

function goToPage(p) { currentPage = p; loadTickets(); }

// ─── Open ticket detail modal ─────────────────────────────────────────────────
async function openTicketDetail(ticketId) {
  currentTicketId = ticketId;
  try {
    const { ticket, messages, activities } = await ticketAPI.getById(ticketId);

    document.getElementById('ticketDetailTitle').textContent =
      `${ticket.ticketNumber} — ${esc(ticket.subject)}`;

    // Customer box
    const icons = { email:'📧 Email', web:'🌐 Web', phone:'📞 Phone', chat:'💬 Chat' };
    document.getElementById('ticketChannel').textContent = icons[ticket.channel] || ticket.channel;
    document.getElementById('ticketCustomerInfo').innerHTML =
      `<strong>${esc(ticket.customer?.name||'Unknown')}</strong><br>
       <a href="mailto:${esc(ticket.customer?.email||'')}">${esc(ticket.customer?.email||'')}</a>`;

    document.getElementById('ticketStatus').value   = ticket.status;
    document.getElementById('ticketPriority').value = ticket.priority;
    populateAgentSelect(document.getElementById('ticketAssignedAgent'));
    document.getElementById('ticketAssignedAgent').value = ticket.assignedAgent?._id || '';
    document.getElementById('replySubject').value =
      `RE: [${ticket.ticketNumber}] ${ticket.subject}`;

    // ── Initial message tab ──
    renderInitialMessage(ticket);

    // ── Conversation tab ──
    renderConversation(messages, ticket);

    // ── Activity log ──
    renderActivityLog(activities);

    // Reset to "Initial Message" tab
    document.querySelectorAll('.conv-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.conv-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.conv-tab[data-panel="initial"]')?.classList.add('active');
    document.getElementById('panel-initial')?.classList.add('active');

    document.getElementById('ticketDetailModal').classList.add('active');
  } catch(e) {
    console.error(e);
    showToast('Failed to load ticket: ' + e.message, 'error');
  }
}

// ─── Initial Message Tab ──────────────────────────────────────────────────────
function renderInitialMessage(ticket) {
  const panel = document.getElementById('initialMsgContent');
  // Prefer ticket.description (always saved from the first inbound email)
  const body        = ticket.description || '(No message body recorded)';
  const fromEmail   = ticket.customer?.email || '';
  const fromName    = ticket.customer?.name  || fromEmail;
  const createdAt   = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '';

  // Render attachments using the shared renderer (handles both rich objects and legacy strings)
  const attachmentsHtml = renderAttachments(ticket.attachments || []);

  panel.innerHTML = `
    <div class="pinned-label">📌 Pinned — original customer message</div>
    <div class="initial-msg-card">
      <div class="from-line">
        🙋 <strong>${esc(fromName)}</strong>
        &lt;${esc(fromEmail)}&gt;
      </div>
      <div class="subject-line">${esc(ticket.subject)}</div>
      <div class="body-text">${esc(body)}</div>
      ${attachmentsHtml}
      <div class="ts">${createdAt}</div>
    </div>`;
}

// ─── Conversation Tab ─────────────────────────────────────────────────────────
function renderConversation(messages, ticket) {
  const list = document.getElementById('messagesList');
  const countBadge = document.getElementById('msgCount');

  // Build the canonical list: always include the customer's first email at top
  // even if it wasn't stored as a separate Message document (older tickets).
  let allMsgs = messages ? [...messages] : [];

  // Check whether the first customer message is already in the thread
  const hasFirstCustomerMsg = allMsgs.some(m => m.senderType === 'customer' && !m.isInternalNote);

  if (!hasFirstCustomerMsg && ticket.description) {
    allMsgs = [{
      _id: 'virtual-initial',
      senderType: 'customer',
      fromEmail: ticket.customer?.email || '',
      senderName: ticket.customer?.name || ticket.customer?.email || 'Customer',
      body: ticket.description,
      subject: ticket.subject,
      createdAt: ticket.createdAt,
      isInternalNote: false,
      _virtual: true
    }, ...allMsgs];
  }

  if (countBadge) countBadge.textContent = allMsgs.length;

  if (!allMsgs.length) {
    list.innerHTML = '<p class="empty" style="color:#9ca3af;padding:16px;">No messages yet.</p>';
    return;
  }

  list.innerHTML = allMsgs.map(m => renderMsgBubble(m)).join('');
  list.scrollTop = list.scrollHeight;
}

function renderMsgBubble(msg) {
  const isAgent    = msg.senderType === 'agent';
  const isInternal = !!msg.isInternalNote;
  const cssClass   = isInternal ? 'internal' : (isAgent ? 'agent' : 'customer');
  const sender     = isAgent
    ? (msg.sender?.name || 'Agent')
    : (msg.senderName || msg.fromEmail || 'Customer');
  const avatar     = isAgent ? '👤' : '🙋';
  const badgeHtml  = isInternal
    ? '<span class="badge-internal">Internal Note</span>'
    : (isAgent ? '<span class="badge-email">📧 Email</span>' : '<span class="badge-customer">Customer</span>');

  // Render attachments using the shared renderer (handles both rich objects and legacy strings)
  const attachmentsHtml = renderAttachments(msg.attachments || []);

  return `
    <div class="msg-bubble ${cssClass}" id="msg-${msg._id}">
      <div class="msg-meta">
        <span>${avatar}</span>
        <span class="msg-sender">${esc(sender)}</span>
        ${badgeHtml}
        <span class="msg-time">${new Date(msg.createdAt).toLocaleString()}</span>
      </div>
      <div class="msg-body">${esc(msg.body)}</div>
      ${msg.toEmail && isAgent ? `<div class="msg-to">To: ${esc(msg.toEmail)}</div>` : ''}
      ${attachmentsHtml}
    </div>`;
}

function appendMessage(msg) {
  const list = document.getElementById('messagesList');
  if (!list) return;
  list.querySelector('.empty')?.remove();
  if (!document.getElementById(`msg-${msg._id}`))
    list.insertAdjacentHTML('beforeend', renderMsgBubble(msg));
  list.scrollTop = list.scrollHeight;

  // Update badge count
  const badge = document.getElementById('msgCount');
  if (badge) badge.textContent = parseInt(badge.textContent||'0', 10) + 1;
}

// ─── Attachment rendering — inline images + download cards ──────────────────
function renderAttachments(attachments) {
  if (!attachments || attachments.length === 0) return '';

  // Normalise: attachments may be rich objects {url,originalName,mimeType,size}
  // or legacy plain strings (old data). Handle both.
  const items = attachments.map(a => {
    if (typeof a === 'string') {
      return { url: a, originalName: a.split('/').pop(), mimeType: '', size: 0 };
    }
    return a;
  }).filter(a => a.url);

  if (items.length === 0) return '';

  const IMAGE_TYPES = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/svg+xml'];

  const isImage = (item) => {
    if (item.mimeType && IMAGE_TYPES.includes(item.mimeType.toLowerCase())) return true;
    const ext = (item.url || '').split('.').pop().toLowerCase().split('?')[0];
    return ['jpg','jpeg','png','gif','webp','svg'].includes(ext);
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1024/1024).toFixed(1)} MB`;
  };

  const fileIcon = (mimeType) => {
    const m = (mimeType || '').toLowerCase();
    if (m.includes('pdf'))   return '📄';
    if (m.includes('word') || m.includes('document')) return '📝';
    if (m.includes('excel') || m.includes('sheet'))   return '📊';
    if (m.includes('zip') || m.includes('rar'))       return '🗜️';
    if (m.includes('text'))  return '📃';
    return '📎';
  };

  const images = items.filter(isImage);
  const files  = items.filter(a => !isImage(a));

  let html = '<div class="msg-attachments">';

  // ── Inline image gallery ──────────────────────────────────────────────────
  if (images.length > 0) {
    html += `<div class="att-images">`;
    html += images.map(img => `
      <a href="${img.url}" target="_blank" rel="noopener noreferrer" class="att-img-wrap" title="${esc(img.originalName || '')}">
        <img src="${img.url}" alt="${esc(img.originalName || 'attachment')}"
             class="att-img"
             onerror="this.closest('.att-img-wrap').classList.add('att-img-error');this.style.display='none'">
        <div class="att-img-overlay">🔍 View</div>
      </a>`).join('');
    html += `</div>`;
  }

  // ── File download cards ───────────────────────────────────────────────────
  if (files.length > 0) {
    html += `<div class="att-files">`;
    html += files.map(f => `
      <a href="${f.url}" target="_blank" rel="noopener noreferrer" class="att-file-card" download="${esc(f.originalName || '')}">
        <span class="att-file-icon">${fileIcon(f.mimeType)}</span>
        <span class="att-file-info">
          <span class="att-file-name">${esc(f.originalName || f.url.split('/').pop())}</span>
          ${f.size ? `<span class="att-file-size">${formatSize(f.size)}</span>` : ''}
        </span>
        <span class="att-file-dl">↓</span>
      </a>`).join('');
    html += `</div>`;
  }

  html += '</div>';
  return html;
}

// ─── File attachment helpers ──────────────────────────────────────────────────
let pendingAttachments = []; // Array of File objects (images, docs, etc.)

// ── Add files from <input type="file"> ────────────────────────────────────────
function handleFileSelect(e) {
  const files = Array.from(e.target.files || []);
  pendingAttachments = [...pendingAttachments, ...files];
  e.target.value = ''; // reset so same file can be re-selected
  updateAttachmentsPreview();
}

// ── Add image from clipboard paste (Ctrl+V) ───────────────────────────────────
function handlePaste(e) {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItems = items.filter(item => item.type.startsWith('image/'));
  if (!imageItems.length) return; // let normal text paste happen
  e.preventDefault();
  imageItems.forEach(item => {
    const file = item.getAsFile();
    if (!file) return;
    // Give it a readable name with timestamp
    const ext  = file.type.split('/')[1] || 'png';
    const name = `pasted-image-${Date.now()}.${ext}`;
    const namedFile = new File([file], name, { type: file.type });
    pendingAttachments = [...pendingAttachments, namedFile];
  });
  updateAttachmentsPreview();
  showToast('📋 Image pasted as attachment', 'info');
}

// ── Render pending attachments as chips INSIDE the reply box area ─────────────
function updateAttachmentsPreview() {
  const preview = document.getElementById('attachmentsPreview');
  const list    = document.getElementById('attachmentsList');
  const countEl = document.getElementById('attachCount');

  if (!pendingAttachments.length) {
    if (preview) preview.style.display = 'none';
    if (countEl) countEl.style.display = 'none';
    return;
  }

  if (preview) preview.style.display = 'block';
  if (countEl) {
    countEl.textContent = `${pendingAttachments.length} file${pendingAttachments.length !== 1 ? 's' : ''} attached`;
    countEl.style.display = 'inline';
  }

  // Each chip: thumbnail for images, icon for files, with remove button
  list.innerHTML = pendingAttachments.map((file, idx) => {
    const isImg      = file.type.startsWith('image/');
    const objectUrl  = isImg ? URL.createObjectURL(file) : null;
    const sizeLabel  = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / 1024 / 1024).toFixed(1)} MB`;

    return `<div class="att-pending-chip" title="${esc(file.name)} (${sizeLabel})">
      ${isImg
        ? `<img src="${objectUrl}" alt="" class="att-chip-thumb" onerror="this.style.display='none'">`
        : `<span class="att-chip-icon">${fileTypeIcon(file.type)}</span>`}
      <span class="att-chip-name">${esc(file.name)}</span>
      <span class="att-chip-size">${sizeLabel}</span>
      <button type="button" class="att-chip-remove" onclick="removeAttachment(${idx})" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function fileTypeIcon(mimeType) {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('pdf'))   return '📄';
  if (m.includes('word') || m.includes('document')) return '📝';
  if (m.includes('excel') || m.includes('sheet'))   return '📊';
  if (m.includes('zip') || m.includes('rar'))       return '🗜️';
  if (m.includes('text'))  return '📃';
  return '📎';
}

function removeAttachment(index) {
  pendingAttachments.splice(index, 1);
  updateAttachmentsPreview();
}

async function uploadAttachments() {
  if (!pendingAttachments.length) return [];

  const formData = new FormData();
  pendingAttachments.forEach(file => formData.append('files', file));

  // NOTE: Do NOT set Content-Type header — browser sets it automatically
  // with the correct multipart boundary for FormData
  // Use the same base URL as all other API calls — avoids 404 when
  // the HTML is proxied or served from a different port (e.g. Next.js dev server)
  const uploadUrl = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '/api')
    .replace(/\/api$/, '') + '/api/upload/message-attachments';

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getAuthToken()}` },
    // Do NOT set Content-Type — browser sets multipart/form-data + boundary automatically
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    console.error('[Upload] Server error:', response.status, errText);
    throw new Error(`Upload failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  // Return rich objects [{url, originalName, mimeType, size}]
  return data.uploadedFiles || [];
}

// ─── Send reply ───────────────────────────────────────────────────────────────
async function sendEmailReply() {
  const body       = document.getElementById('replyBody')?.value?.trim();
  const isInternal = document.getElementById('isInternalNote')?.checked;
  if (!body) { showToast('Please enter a message.', 'warning'); return; }

  const btn = document.getElementById('sendReplyBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    // Upload attachments first (throws on failure so we never send a partial message)
    let attachmentObjects = [];
    if (pendingAttachments.length > 0) {
      try {
        attachmentObjects = await uploadAttachments();
        console.log('[Reply] Attachments uploaded:', attachmentObjects);
      } catch (uploadErr) {
        console.error('[Reply] Upload failed:', uploadErr);
        showToast('⚠️ File upload failed — ' + uploadErr.message, 'error');
        return; // Stop — don't send text without attachments if user added them
      }
    }

    if (isInternal) {
      await ticketAPI.addMessage(currentTicketId, body, true, attachmentObjects);
      showToast('Internal note added.', 'success');
    } else {
      // Append signature to outgoing email if set
      const sigText = document.getElementById('replySignatureText')?.textContent?.trim();
      const fullBody = sigText ? body + '\n\n-- \n' + sigText : body;
      await gmailAPI.sendReply(currentTicketId, fullBody, attachmentObjects);
      showToast('✅ Email reply sent!', 'success');
    }

    document.getElementById('replyBody').value = '';
    pendingAttachments = [];
    updateAttachmentsPreview();
    document.getElementById('attachmentInput').value = '';

    // Reload conversation to keep everything in sync
    const { ticket, messages, activities } = await ticketAPI.getById(currentTicketId);
    renderConversation(messages, ticket);
    renderActivityLog(activities);

    // Switch to Conversation tab automatically after first reply
    document.querySelectorAll('.conv-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.conv-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.conv-tab[data-panel="conversation"]')?.classList.add('active');
    document.getElementById('panel-conversation')?.classList.add('active');

  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📧 Send Reply'; }
  }
}

// ─── Update ticket ────────────────────────────────────────────────────────────
async function updateTicket(data) {
  try {
    await ticketAPI.update(currentTicketId, data);
    const { activities } = await ticketAPI.getById(currentTicketId);
    renderActivityLog(activities);
    showToast('Ticket updated.', 'success');
    refreshTabCounts();
  } catch(e) { showToast('Update failed: ' + e.message, 'error'); }
}

// ─── Activity log ─────────────────────────────────────────────────────────────
function renderActivityLog(activities) {
  const log = document.getElementById('activityLog');
  if (!log) return;
  if (!activities?.length) { log.innerHTML = '<p style="font-size:12px;color:#9ca3af;">No activity yet.</p>'; return; }
  log.innerHTML = activities.map(a => `
    <div class="activity-item">
      <span class="activity-time">${new Date(a.createdAt).toLocaleString()}</span>
      <span class="activity-text">
        <strong>${esc(a.user?.name || 'System')}</strong>
        ${esc(a.description || a.action)}
        ${a.oldValue ? `<span class="old-val">${esc(a.oldValue)}</span>` : ''}
        ${a.newValue ? `→ <span class="new-val">${esc(a.newValue)}</span>` : ''}
      </span>
    </div>`).join('');
}

// ─── Auto-assign all unassigned active tickets ────────────────────────────────
async function autoAssignAll() {
  const btn = document.getElementById('autoAssignBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Assigning…'; }

  try {
    const active = agentList.filter(a => a.status === 'active');
    if (!active.length) { showToast('No active agents.', 'warning'); return; }

    const [openData, ipData] = await Promise.all([
      ticketAPI.getAll({ unassigned:'true', status:'open',        limit:100 }),
      ticketAPI.getAll({ unassigned:'true', status:'in-progress', limit:100 })
    ]);

    const pool = [...(openData.tickets||[]), ...(ipData.tickets||[])];
    if (!pool.length) { showToast('No unassigned active tickets.', 'info'); return; }

    let count = 0;
    for (const t of pool) {
      const agent = active[autoAssignIndex % active.length];
      autoAssignIndex++;
      await ticketAPI.update(t._id, { assignedAgent: agent._id });
      if (agent._id === currentUserId) {
        playAssignSound();
        showToast(`🔔 Ticket ${t.ticketNumber} auto-assigned to you!`, 'info');
      }
      count++;
    }

    showToast(`✅ ${count} ticket(s) assigned across ${active.length} agent(s).`, 'success');
    await loadTickets();
    await refreshTabCounts();
  } catch(e) {
    showToast('Auto-assign failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Auto Assign'; }
  }
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
  const colors = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'#3b82f6' };
  const t = document.createElement('div');
  t.style.cssText = `background:${colors[type]};color:#fff;padding:12px 20px;border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,.2);font-size:14px;max-width:320px;animation:slideIn .3s ease;`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; }, 3500);
  setTimeout(() => t.remove(), 4000);
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Delete ticket (admin only) ────────────────────────────────────────────
let pendingDeleteId   = null;
let pendingDeleteNum  = null;

function deleteTicket(id, ticketNumber) {
  pendingDeleteId  = id;
  pendingDeleteNum = ticketNumber;

  // Build or reuse confirm modal
  let modal = document.getElementById('deleteTicketConfirmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deleteTicketConfirmModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:380px;">
        <div class="modal-header">
          <h2>Delete Ticket</h2>
          <button class="close-btn" onclick="document.getElementById('deleteTicketConfirmModal').classList.remove('active')">&times;</button>
        </div>
        <div style="padding:24px;text-align:center;">
          <p style="color:var(--text-secondary);font-size:14px;margin:0 0 20px;">
            Permanently delete <strong id="deleteTicketLabelTickets"></strong>?<br>
            All messages and activity will be removed.
          </p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button class="btn btn-danger" id="confirmDeleteTicketBtn">Yes, Delete</button>
            <button class="btn btn-secondary" onclick="document.getElementById('deleteTicketConfirmModal').classList.remove('active')">Cancel</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('confirmDeleteTicketBtn').addEventListener('click', async () => {
      if (!pendingDeleteId) return;
      const btn = document.getElementById('confirmDeleteTicketBtn');
      btn.disabled = true; btn.textContent = 'Deleting…';
      try {
        await ticketAPI.delete(pendingDeleteId);
        document.getElementById('deleteTicketConfirmModal').classList.remove('active');
        if (pendingDeleteId === currentTicketId) {
          document.getElementById('ticketDetailModal').classList.remove('active');
          currentTicketId = null;
        }
        pendingDeleteId = null;
        await loadTickets();
        showToast('Ticket deleted.', 'success');
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Yes, Delete';
      }
    });

    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  }

  document.getElementById('deleteTicketLabelTickets').textContent = ticketNumber;
  modal.classList.add('active');
}
