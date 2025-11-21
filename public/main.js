// Simple tab logic
const loginSection = document.getElementById('login-section');
const registerSection = document.getElementById('register-section');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginSection.classList.remove('hidden');
  registerSection.classList.add('hidden');
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerSection.classList.remove('hidden');
  loginSection.classList.add('hidden');
});

// Gender other field
const genderSelect = document.getElementById('gender-select');
const genderOtherWrapper = document.getElementById('gender-other-wrapper');

genderSelect.addEventListener('change', () => {
  if (genderSelect.value === 'other') {
    genderOtherWrapper.classList.remove('hidden');
  } else {
    genderOtherWrapper.classList.add('hidden');
  }
});

// Password generator
const passwordInput = document.getElementById('password-input');
const generateBtn = document.getElementById('generate-password');

function generateStrongPassword(length = 12) {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

generateBtn.addEventListener('click', () => {
  passwordInput.value = generateStrongPassword();
});

// Register form
const registerForm = document.getElementById('register-form');
const registerResult = document.getElementById('register-result');
const registerSpinner = document.getElementById('register-spinner');
const registerSubmitBtn = registerForm.querySelector('button[type="submit"]');

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(registerForm);
  const data = Object.fromEntries(formData.entries());

  registerResult.textContent = '';
  registerResult.classList.remove('error');
  registerSpinner.classList.remove('hidden');
  registerSubmitBtn.disabled = true;

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const json = await res.json();
    if (!res.ok) {
      registerResult.textContent = json.error || 'Registration failed';
      registerResult.classList.add('error');
      return;
    }

    registerResult.classList.remove('error');
    registerResult.innerHTML =
      `✅ Registered!<br>` +
      `Your login code: <strong>${json.code}</strong><br>` +
      `Your password: <strong>${data.password}</strong><br>` +
      `This will also be emailed to you. Please save it.`;
  } catch (err) {
    console.error(err);
    registerResult.textContent = 'Network error';
    registerResult.classList.add('error');
  } finally {
    registerSpinner.classList.add('hidden');
    registerSubmitBtn.disabled = false;
  }
});

// Login form
const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(loginForm);
  const data = Object.fromEntries(formData.entries());

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      loginMessage.textContent = json.error || 'Login failed';
      loginMessage.classList.add('error');
      return;
    }

    loginMessage.classList.remove('error');
    loginMessage.textContent = 'Login successful! Redirecting...';

    if (json.role === 'admin') {
      window.location.href = '/admin.html';
    } else {
      window.location.href = '/participant.html';
    }
  } catch (err) {
    console.error(err);
    loginMessage.textContent = 'Network error';
    loginMessage.classList.add('error');
  }
});
