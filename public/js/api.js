// Dynamically resolve API base — works whether frontend is served by Express (port 5000)
// or a separate dev server (port 3000, etc.)
const API_BASE_URL = (() => {
  if (window.location.hostname === 'localhost') {
    return 'https://trademav.info/api';
  }
  return 'https://trademav.info/api'; // ← your backend URL
})();
let authToken = localStorage.getItem('authToken');

const setAuthToken = (token) => {
  authToken = token;
  localStorage.setItem('authToken', token);
};

const getAuthToken = () => {
  return authToken;
};

const clearAuthToken = () => {
  authToken = null;
  localStorage.removeItem('authToken');
};

const apiCall = async (endpoint, method = 'GET', body = null) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    
    if (response.status === 401) {
      clearAuthToken();
      window.location.href = '/login.html';
      return null;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'API Error');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error.message);
    throw error;
  }
};

// Auth APIs
const authAPI = {
  register: (name, email, password, role) => 
    apiCall('/auth/register', 'POST', { name, email, password, role }),
  login: (email, password) => 
    apiCall('/auth/login', 'POST', { email, password }),
  getCurrentUser: () => 
    apiCall('/auth/me', 'GET'),
  updateStatus: (status) =>
    apiCall('/auth/status', 'PUT', { status }),
  getTeamMembers: () =>
    apiCall('/auth/team', 'GET'),
  inviteAgent: (name, email, role) =>
    apiCall('/auth/invite', 'POST', { name, email, role }),
  resendInvite: (id) =>
    apiCall(`/auth/resend-invite/${id}`, 'POST'),
  deleteTeamMember: (id) =>
    apiCall(`/auth/team/${id}`, 'DELETE'),
  // Pending approvals
  getPendingApprovals: () =>
    apiCall('/auth/pending-approvals', 'GET'),
  approveRegistration: (id) =>
    apiCall(`/auth/approve-registration/${id}`, 'POST'),
  rejectRegistration: (id) =>
    apiCall(`/auth/reject-registration/${id}`, 'POST'),
  approveProfileChange: (id) =>
    apiCall(`/auth/approve-profile/${id}`, 'POST'),
  rejectProfileChange: (id) =>
    apiCall(`/auth/reject-profile/${id}`, 'POST'),
  submitProfileChange: (data) =>
    apiCall('/auth/profile-change', 'POST', data),
  approvePasswordReset: (id) =>
    apiCall(`/auth/approve-password-reset/${id}`, 'POST'),
  rejectPasswordReset: (id) =>
    apiCall(`/auth/reject-password-reset/${id}`, 'POST')
};

// Ticket APIs
const ticketAPI = {
  create: (subject, description, customerId, priority, category) =>
    apiCall('/tickets', 'POST', { subject, description, customerId, priority, category }),
  getAll: (filters) => {
    const params = new URLSearchParams(filters);
    return apiCall(`/tickets?${params.toString()}`, 'GET');
  },
  getById: (id) =>
    apiCall(`/tickets/${id}`, 'GET'),
  update: (id, data) =>
    apiCall(`/tickets/${id}`, 'PUT', data),
  close: (id) =>
    apiCall(`/tickets/${id}/close`, 'PUT', {}),
  addMessage: (ticketId, body, isInternalNote, attachments, subject, ccEmail, bccEmail) =>
    apiCall(`/tickets/${ticketId}/messages`, 'POST', {
      body,
      isInternalNote,
      attachments: attachments || [],
      subject,
      ccEmail,
      bccEmail
    }),
  getMessages: (ticketId) =>
    apiCall(`/tickets/${ticketId}/messages`, 'GET'),
  addCustomerReply: (ticketId, body, email) =>
    apiCall(`/tickets/${ticketId}/customer-reply`, 'POST', { body, email }),
  getReports: () =>
    apiCall('/tickets/reports', 'GET'),
  getDashboardStats: () =>
    apiCall('/tickets/dashboard-stats', 'GET'),
  delete: (id) =>
    apiCall(`/tickets/${id}`, 'DELETE')
};

// Customer APIs
const customerAPI = {
  create: (name, email, phone, company, notes) =>
    apiCall('/customers', 'POST', { name, email, phone, company, notes }),
  getAll: (page, limit, search) => {
    const params = new URLSearchParams({ page, limit });
    if (search) params.append('search', search);
    return apiCall(`/customers?${params.toString()}`, 'GET');
  },
  getById: (id) =>
    apiCall(`/customers/${id}`, 'GET'),
  update: (id, data) =>
    apiCall(`/customers/${id}`, 'PUT', data),
  delete: (id) =>
    apiCall(`/customers/${id}`, 'DELETE')
};

// Gmail / Email APIs
const gmailAPI = {
  sendReply: (ticketId, body, attachments = [], ccEmails = [], bccEmails = []) =>
    apiCall(`/gmail/send-reply/${ticketId}`, 'POST', { body, attachments, ccEmails, bccEmails }),
  getEmailHistory: (ticketId) =>
    apiCall(`/gmail/${ticketId}/emails`, 'GET'),
  testIncoming: (from, subject, body) =>
    apiCall('/gmail/test-incoming', 'POST', { from, subject, body })
};

// Profile & Settings APIs
authAPI.updateProfile      = (data) => apiCall('/auth/profile', 'PUT', data);
authAPI.changePassword     = (currentPassword, newPassword) =>
  apiCall('/auth/change-password', 'PUT', { currentPassword, newPassword });
authAPI.updatePreferences  = (data) => apiCall('/auth/preferences', 'PUT', data);
authAPI.getLoginActivity   = () => apiCall('/auth/login-activity', 'GET');

// ── Restore saved theme on every page load ───────────────────────────────────
(function() {
  const t = localStorage.getItem('theme') || 'light';
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
})();

