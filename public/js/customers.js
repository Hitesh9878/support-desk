let currentPage = 1;
let currentCustomerId = null;
const customersPerPage = 10;

document.addEventListener('DOMContentLoaded', async () => {
  // Refresh button
  setTimeout(() => {
    document.getElementById('refreshCustomersBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('refreshCustomersBtn');
      btn.disabled = true; btn.textContent = '🔄 Refreshing…';
      if (typeof loadCustomers === 'function') await loadCustomers();
      btn.disabled = false; btn.textContent = '🔄 Refresh';
    });
  }, 100);
  if (!getAuthToken()) {
    window.location.href = '/login.html';
    return;
  }

  await loadCustomers();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('searchBtn').addEventListener('click', () => {
    currentPage = 1;
    loadCustomers();
  });

  document.getElementById('newCustomerBtn').addEventListener('click', () => {
    document.getElementById('newCustomerModal').classList.add('active');
  });

  document.getElementById('newCustomerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await createNewCustomer();
  });

  document.getElementById('cancelNewCustomerBtn').addEventListener('click', () => {
    document.getElementById('newCustomerModal').classList.remove('active');
  });

  document.querySelector('#customerDetailModal .close-btn').addEventListener('click', () => {
    document.getElementById('customerDetailModal').classList.remove('active');
  });

  document.getElementById('closeDetailBtn').addEventListener('click', () => {
    document.getElementById('customerDetailModal').classList.remove('active');
  });

  document.getElementById('saveCustomerBtn').addEventListener('click', async () => {
    await updateCustomer();
  });

  document.getElementById('deleteCustomerBtn').addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete this customer?')) {
      await deleteCustomer();
    }
  });

  // Close modals on background click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
}

async function loadCustomers() {
  const search = document.getElementById('searchInput').value;

  try {
    const data = await customerAPI.getAll(currentPage, customersPerPage, search);
    displayCustomers(data.customers);
    displayPagination(data.totalPages);
  } catch (error) {
    console.error('Error loading customers:', error);
  }
}

function displayCustomers(customers) {
  const tbody = document.getElementById('customersTableBody');

  if (customers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No customers found</td></tr>';
    return;
  }

  tbody.innerHTML = customers.map(customer => `
    <tr onclick="openCustomerDetail('${customer._id}')">
      <td><strong>${customer.name}</strong></td>
      <td>${customer.email}</td>
      <td>${customer.company || '-'}</td>
      <td>${customer.phone || '-'}</td>
      <td>${customer.totalTickets || 0}</td>
      <td>$${customer.totalSpent || 0}</td>
      <td><span class="status status-${customer.status}">${customer.status}</span></td>
      <td><button class="btn-small" onclick="openCustomerDetail('${customer._id}'); event.stopPropagation();">View</button></td>
    </tr>
  `).join('');
}

function displayPagination(totalPages) {
  const container = document.getElementById('paginationContainer');
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadCustomers();
}

async function openCustomerDetail(customerId) {
  currentCustomerId = customerId;

  try {
    const customer = await customerAPI.getById(customerId);
    
    document.getElementById('customerDetailTitle').textContent = customer.name;
    document.getElementById('detailName').value = customer.name;
    document.getElementById('detailEmail').value = customer.email;
    document.getElementById('detailPhone').value = customer.phone || '';
    document.getElementById('detailCompany').value = customer.company || '';
    document.getElementById('detailStatus').value = customer.status;
    document.getElementById('detailNotes').value = customer.notes || '';

    // Load customer tickets
    const ticketsData = await ticketAPI.getAll({ customerId: customerId, limit: 100 });
    displayCustomerTickets(ticketsData.tickets);

    document.getElementById('customerDetailModal').classList.add('active');
  } catch (error) {
    console.error('Error loading customer:', error);
  }
}

function displayCustomerTickets(tickets) {
  const list = document.getElementById('customerTicketsList');

  if (tickets.length === 0) {
    list.innerHTML = '<p class="empty">No tickets for this customer</p>';
    return;
  }

  list.innerHTML = tickets.map(ticket => `
    <div class="ticket-card">
      <div class="ticket-header">
        <span class="ticket-number">${ticket.ticketNumber}</span>
        <span class="status status-${ticket.status}">${ticket.status}</span>
      </div>
      <div class="ticket-subject">${ticket.subject}</div>
      <div class="ticket-meta">
        <span>${new Date(ticket.createdAt).toLocaleDateString()}</span>
        <span class="priority priority-${ticket.priority}">${ticket.priority}</span>
      </div>
    </div>
  `).join('');
}

async function createNewCustomer() {
  const name = document.getElementById('newName').value;
  const email = document.getElementById('newEmail').value;
  const phone = document.getElementById('newPhone').value;
  const company = document.getElementById('newCompany').value;

  try {
    await customerAPI.create(name, email, phone, company);
    document.getElementById('newCustomerModal').classList.remove('active');
    document.getElementById('newCustomerForm').reset();
    await loadCustomers();
  } catch (error) {
    alert('Error creating customer: ' + error.message);
  }
}

async function updateCustomer() {
  const phone = document.getElementById('detailPhone').value;
  const company = document.getElementById('detailCompany').value;
  const status = document.getElementById('detailStatus').value;
  const notes = document.getElementById('detailNotes').value;

  try {
    await customerAPI.update(currentCustomerId, {
      phone,
      company,
      status,
      notes
    });
    alert('Customer updated successfully');
    document.getElementById('customerDetailModal').classList.remove('active');
    await loadCustomers();
  } catch (error) {
    alert('Error updating customer: ' + error.message);
  }
}

async function deleteCustomer() {
  try {
    await customerAPI.delete(currentCustomerId);
    alert('Customer deleted successfully');
    document.getElementById('customerDetailModal').classList.remove('active');
    await loadCustomers();
  } catch (error) {
    alert('Error deleting customer: ' + error.message);
  }
}
