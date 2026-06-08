document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  const token = getAuthToken();
  if (token && window.location.pathname.includes('login')) {
    window.location.href = '/dashboard.html';
  }

  // Tab switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const forms = document.querySelectorAll('.auth-form');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      forms.forEach(f => f.classList.remove('active'));
      btn.classList.add('active');
      const tabName = btn.dataset.tab;
      document.getElementById(`${tabName}Form`).classList.add('active');
    });
  });

  // Login form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;

      try {
        const response = await authAPI.login(email, password);
        setAuthToken(response.token);
        localStorage.setItem('user', JSON.stringify(response.user));
        window.location.href = '/dashboard.html';
      } catch (error) {
        document.getElementById('loginError').textContent = error.message;
      }
    });
  }

  // Register form
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('registerName').value;
      const email = document.getElementById('registerEmail').value;
      const password = document.getElementById('registerPassword').value;
      const role = document.getElementById('registerRole').value;

      try {
        const response = await authAPI.register(name, email, password, role);
        setAuthToken(response.token);
        localStorage.setItem('user', JSON.stringify(response.user));
        window.location.href = '/dashboard.html';
      } catch (error) {
        document.getElementById('registerError').textContent = error.message;
      }
    });
  }
});
