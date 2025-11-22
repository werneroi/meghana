const logoutBtn = document.getElementById('logout-btn');
const socketStatus = document.getElementById('socket-status');
const pingBtn = document.getElementById('ping-btn');
const formsSidebar = document.getElementById('forms-sidebar');
const formsMessage = document.getElementById('forms-message');
const formStage = document.getElementById('form-stage');

// Check if logged in
async function checkAuth() {
  const res = await fetch('/api/me');
  const json = await res.json();
  if (!json.user || json.user.role !== 'participant') {
    window.location.href = '/';
  }
}
checkAuth();

// Socket.IO
const socket = io();

socket.on('connect', () => {
  socketStatus.textContent = `Connected. Socket ID: ${socket.id}`;
});

socket.on('disconnect', () => {
  socketStatus.textContent = 'Disconnected from server.';
});

socket.on('pong', (data) => {
  pongResult.textContent = `Pong from server at ${data.time}`;
});

pingBtn.addEventListener('click', () => {
  socket.emit('ping');
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// --- Forms for participants ---
let formsCache = [];
let responsesCache = {};

async function loadForms() {
  formsMessage.textContent = 'Loading...';
  formsSidebar.innerHTML = '';
  formStage.innerHTML = '<p>Select an action from the sidebar.</p>';
  responsesCache = {};
  try {
    const res = await fetch('/api/forms/available');
    if (!res.ok) throw new Error('Failed to load forms');
    const data = await res.json();
    formsCache = data.forms || [];
    if (formsCache.length === 0) {
      formsMessage.textContent = 'No forms available right now.';
      return;
    }
    formsMessage.textContent = '';
    // preload responses
    for (const form of formsCache) {
      responsesCache[form.id] = await fetchResponse(form.id);
    }
    renderSidebar();
    renderForm(formatsFirstOrSelected());
  } catch (err) {
    console.error(err);
    formsMessage.textContent = 'Could not load forms.';
  }
}

function formatsFirstOrSelected(selectedId) {
  if (selectedId) return formsCache.find((f) => f.id === selectedId) || formsCache[0];
  return formsCache[0];
}

async function fetchResponse(formId) {
  try {
    const res = await fetch(`/api/forms/${formId}/response`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.response || null;
  } catch (err) {
    return null;
  }
}

function renderSidebar(activeId) {
  formsSidebar.innerHTML = '';
  formsCache.forEach((form) => {
    const li = document.createElement('li');
    li.className = 'sidebar-item';
    if (!activeId && form === formsCache[0]) li.classList.add('active');
    if (activeId === form.id) li.classList.add('active');
    li.textContent = form.title;
    li.addEventListener('click', () => {
      renderSidebar(form.id);
      renderForm(form);
    });
    formsSidebar.appendChild(li);
  });
}

function renderForm(form) {
  formStage.innerHTML = '';
  if (!form) {
    formStage.innerHTML = '<p>No forms to show.</p>';
    return;
  }
  const response = responsesCache[form.id];

  const formCard = document.createElement('div');
  formCard.className = 'form-card';
  const title = document.createElement('h3');
  title.textContent = form.title;
  const desc = document.createElement('p');
  desc.textContent = form.description || '';
  const info = document.createElement('div');
  info.textContent = `Release: ${new Date(form.release_at).toLocaleString()}`;
  const messageEl = document.createElement('div');
  messageEl.className = 'message';

  const htmlForm = document.createElement('form');
  htmlForm.dataset.formId = form.id;

  (form.questions || []).forEach((q) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-question';
    const label = document.createElement('label');
    label.innerHTML = `${q.label}${q.required ? ' *' : ''}`;
    wrapper.appendChild(label);

    const existingValue = response?.answers?.[q.id];

    if (q.type === 'short_text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `q-${q.id}`;
      if (existingValue) input.value = existingValue;
      wrapper.appendChild(input);
    } else if (q.type === 'long_text') {
      const textarea = document.createElement('textarea');
      textarea.name = `q-${q.id}`;
      textarea.rows = 3;
      if (existingValue) textarea.value = existingValue;
      wrapper.appendChild(textarea);
    } else if (q.type === 'dropdown') {
      const select = document.createElement('select');
      select.name = `q-${q.id}`;
      select.innerHTML = `<option value="">Select...</option>`;
      (q.options || []).forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (existingValue === opt) option.selected = true;
        select.appendChild(option);
      });
      wrapper.appendChild(select);
    } else if (q.type === 'select_one') {
      (q.options || []).forEach((opt, idx) => {
        const id = `q-${q.id}-${idx}`;
        const radioWrapper = document.createElement('div');
        radioWrapper.className = 'option-row';
        radioWrapper.innerHTML = `
          <input type="radio" name="q-${q.id}" id="${id}" value="${opt}" ${existingValue === opt ? 'checked' : ''}/>
          <label for="${id}">${opt}</label>
        `;
        wrapper.appendChild(radioWrapper);
      });
    } else if (q.type === 'select_multiple') {
      const existingArray = Array.isArray(existingValue) ? existingValue : [];
      (q.options || []).forEach((opt, idx) => {
        const id = `q-${q.id}-multi-${idx}`;
        const cbWrapper = document.createElement('div');
        cbWrapper.className = 'option-row';
        cbWrapper.innerHTML = `
          <input type="checkbox" name="q-${q.id}" id="${id}" value="${opt}" ${existingArray.includes(opt) ? 'checked' : ''}/>
          <label for="${id}">${opt}</label>
        `;
        wrapper.appendChild(cbWrapper);
      });
    }

    htmlForm.appendChild(wrapper);
  });

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = response ? 'Update response' : 'Submit response';
  htmlForm.appendChild(submitBtn);

  htmlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    messageEl.textContent = 'Saving...';
    messageEl.classList.remove('error');
    try {
      const answers = collectAnswers(form, htmlForm);
      const res = await fetch(`/api/forms/${form.id}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      messageEl.textContent = 'Saved';
      responsesCache[form.id] = await fetchResponse(form.id);
      renderSidebar(form.id);
    } catch (err) {
      console.error(err);
      messageEl.textContent = err.message;
      messageEl.classList.add('error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  formCard.appendChild(title);
  formCard.appendChild(desc);
  formCard.appendChild(info);
  formCard.appendChild(htmlForm);
  formCard.appendChild(messageEl);
  formStage.appendChild(formCard);
}

function collectAnswers(form, scopeEl) {
  const answers = {};
  (form.questions || []).forEach((q) => {
    if (q.type === 'select_multiple') {
      const boxes = Array.from(scopeEl.querySelectorAll(`input[name="q-${q.id}"]:checked`));
      answers[q.id] = boxes.map((b) => b.value);
    } else if (q.type === 'select_one') {
      const selected = scopeEl.querySelector(`input[name="q-${q.id}"]:checked`);
      answers[q.id] = selected ? selected.value : '';
    } else {
      const input = scopeEl.querySelector(`[name="q-${q.id}"]`);
      answers[q.id] = input ? input.value : '';
    }
  });
  return answers;
}

loadForms();
