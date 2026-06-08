document.addEventListener('DOMContentLoaded', async () => {
  if (!getAuthToken()) { window.location.href = '/login.html'; return; }
  await loadReports();

  document.getElementById('refreshReportsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshReportsBtn');
    btn.disabled = true; btn.textContent = '🔄 Refreshing…';
    await loadReports();
    btn.disabled = false; btn.textContent = '🔄 Refresh';
  });

  document.getElementById('exportBtn')?.addEventListener('click', exportCSV);
});

async function loadReports() {
  try {
    const data = await ticketAPI.getReports();

    // ── Scope banner ──
    const banner = document.getElementById('reportScopeBanner');
    if (banner) {
      if (data.scope === 'mine') {
        banner.style.display = 'flex';
        banner.textContent   = '📋 Showing your assigned tickets only. Admins see all tickets.';
      } else {
        banner.style.display = 'none';
      }
    }

    // ── Stats ──
    document.getElementById('totalTickets').textContent       = data.stats.total;
    document.getElementById('openTickets').textContent        = data.stats.open;
    document.getElementById('avgResolutionTime').textContent  = data.stats.avgResolutionHours + 'h';
    document.getElementById('slaCompliance').textContent      = data.stats.slaCompliance + '%';

    // ── Priority table ──
    const pTotal = data.stats.total || 1;
    document.getElementById('priorityTable').innerHTML = Object.entries(data.priorities).map(([p, count]) => {
      const pct = Math.round((count / pTotal) * 100);
      return `<tr>
        <td><span class="priority priority-${p}">${p}</span></td>
        <td>${count}</td>
        <td>${pct}%</td>
        <td><div class="progress-bar-wrapper"><div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div><span class="progress-pct">${pct}%</span></div></td>
      </tr>`;
    }).join('');

    // ── Status table ──
    document.getElementById('statusTable').innerHTML = Object.entries(data.statuses).map(([s, count]) => {
      const pct = Math.round((count / pTotal) * 100);
      return `<tr>
        <td><span class="status status-${s}">${s}</span></td>
        <td>${count}</td>
        <td>${pct}%</td>
        <td><div class="progress-bar-wrapper"><div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div><span class="progress-pct">${pct}%</span></div></td>
      </tr>`;
    }).join('');

    // ── Agent table ──
    document.getElementById('agentTable').innerHTML = data.agents.length
      ? data.agents.map(a => `<tr>
          <td>${esc(a.name)}</td>
          <td>${a.assigned}</td>
          <td>${a.resolved}</td>
          <td>${a.assigned > 0 ? Math.round((a.resolved / a.assigned) * 100) + '%' : '—'}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty">No agent data yet</td></tr>';

    // ── Customers table ──
    document.getElementById('customersTable').innerHTML = data.customers.length
      ? data.customers.map(c => `<tr>
          <td>${esc(c.name)}</td>
          <td>${c.total}</td>
          <td>${c.active}</td>
          <td>${c.resolved}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty">No customer data yet</td></tr>';

    // ── Activity trend ──
    const sorted = Object.entries(data.activity).sort(([a],[b]) => a.localeCompare(b));
    const maxCount = Math.max(...sorted.map(([,v]) => v), 1);
    document.getElementById('activityText').innerHTML = sorted.length
      ? sorted.map(([date, count]) => `
          <div class="activity-item">
            <span class="date">${date}</span>
            <div class="bar-wrap"><div class="bar-fill" style="width:${Math.round((count/maxCount)*200)}px"></div></div>
            <span class="count">${count} ticket${count!==1?'s':''}</span>
          </div>`).join('')
      : '<p class="empty">No activity in last 30 days</p>';

  } catch (err) {
    console.error('Reports error:', err);
    document.getElementById('activityText').innerHTML = '<p class="empty">Error loading reports. Please refresh.</p>';
  }
}

async function exportCSV() {
  try {
    const data = await ticketAPI.getAll({ page: 1, limit: 10000 });
    const tickets = data.tickets;
    const headers = ['Ticket #', 'Subject', 'Customer', 'Status', 'Priority', 'Assigned To', 'Created'];
    let csv = headers.join(',') + '\n';
    tickets.forEach(t => {
      csv += [t.ticketNumber, `"${t.subject}"`, t.customer?.name || 'Unknown',
              t.status, t.priority, t.assignedAgent?.name || 'Unassigned',
              new Date(t.createdAt).toLocaleDateString()].join(',') + '\n';
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `trademav-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  } catch (err) { alert('Export failed: ' + err.message); }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
