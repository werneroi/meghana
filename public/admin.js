const logoutBtn = document.getElementById('logout-btn');
const sidebarItems = document.querySelectorAll('#admin-sidebar .sidebar-item');
const databaseView = document.getElementById('database-view');
const formsView = document.getElementById('forms-view');

// Database elements
const tablesListEl = document.getElementById('tables-list');
const tableContainer = document.getElementById('table-container');
const tableMessage = document.getElementById('table-message');
const tableTitle = document.getElementById('table-title');

// Form builder elements
const formsListEl = document.getElementById('forms-list');
const addQuestionBtn = document.getElementById('add-question-btn');
const questionsContainer = document.getElementById('questions-container');
const saveFormBtn = document.getElementById('save-form-btn');
const formTitleInput = document.getElementById('form-title');
const formDescriptionInput = document.getElementById('form-description');
const formReleaseInput = document.getElementById('form-release');
const formActiveInput = document.getElementById('form-active');
const formBuilderMessage = document.getElementById('form-builder-message');
const newFormBtn = document.getElementById('new-form-btn');
const formBuilderTitle = document.getElementById('form-builder-title');

let editingFormId = null;

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// --- Sidebar navigation ---
function setView(view) {
  sidebarItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  databaseView.classList.toggle('hidden', view !== 'database');
  formsView.classList.toggle('hidden', view !== 'forms');
  if (view === 'database') {
    loadTables();
  } else {
    loadForms();
  }
}

sidebarItems.forEach((item) => {
  item.addEventListener('click', () => setView(item.dataset.view));
});

// --- Database explorer ---
async function loadTables() {
  tablesListEl.innerHTML = '<li>Loading...</li>';
  tableContainer.innerHTML = '';
  tableMessage.textContent = '';
  tableTitle.textContent = 'Select a table';
  try {
    const res = await fetch('/api/admin/db/tables');
    if (!res.ok) throw new Error('Failed to load tables');
    const data = await res.json();
    const tables = data.tables || [];
    if (tables.length === 0) {
      tablesListEl.innerHTML = '<li>No tables</li>';
      return;
    }
    tablesListEl.innerHTML = '';
    tables.forEach((t, idx) => {
      const li = document.createElement('li');
      li.className = 'sidebar-item';
      li.textContent = t;
      if (idx === 0) li.classList.add('active');
      li.addEventListener('click', () => {
        tablesListEl.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
        li.classList.add('active');
        loadTableData(t);
      });
      tablesListEl.appendChild(li);
    });
    // auto load first
    loadTableData(tables[0]);
  } catch (err) {
    console.error(err);
    tablesListEl.innerHTML = '<li>Error loading tables</li>';
  }
}

async function loadTableData(tableName) {
  tableMessage.textContent = 'Loading...';
  tableContainer.innerHTML = '';
  tableTitle.textContent = tableName;
  try {
    const res = await fetch(`/api/admin/db/table/${tableName}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load table');
    renderTable(data.columns || [], data.rows || []);
    tableMessage.textContent = '';
  } catch (err) {
    console.error(err);
    tableMessage.textContent = err.message;
    tableMessage.classList.add('error');
  }
}

function renderTable(columns, rows) {
  if (columns.length === 0) {
    tableContainer.innerHTML = '<p>No columns.</p>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'data-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const td = document.createElement('td');
      const val = row[col];
      td.textContent = val === null || val === undefined ? '' : formatValue(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableContainer.innerHTML = '';
  tableContainer.appendChild(table);
}

function formatValue(v) {
  if (v instanceof Date) return v.toLocaleString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// --- Form builder helpers ---
function clearBuilder(defaultQuestions = true) {
  editingFormId = null;
  formBuilderTitle.textContent = 'Form Builder';
  formTitleInput.value = '';
  formDescriptionInput.value = '';
  formReleaseInput.value = new Date().toISOString().slice(0, 16);
  formActiveInput.checked = true;
  questionsContainer.innerHTML = '';
  formBuilderMessage.textContent = '';
  formBuilderMessage.classList.remove('error');

  if (defaultQuestions) {
    addQuestionRow({ label: 'Short text example', type: 'short_text', required: true });
    addQuestionRow({ label: 'Dropdown example', type: 'dropdown', options: ['Option A', 'Option B'] });
    addQuestionRow({ label: 'Single choice example', type: 'select_one', options: ['Yes', 'No'] });
    addQuestionRow({ label: 'Multiple choice example', type: 'select_multiple', options: ['Red', 'Green', 'Blue'] });
    addQuestionRow({ label: 'Long text example', type: 'long_text' });
  }
}

function addQuestionRow(initial = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'question-row';
  wrapper.innerHTML = `
    <label>Question text
      <input type="text" class="q-label" value="${initial.label ? initial.label : ''}" />
    </label>
    <label>Type
      <select class="q-type">
        <option value="short_text">Short text</option>
        <option value="long_text">Long text</option>
        <option value="dropdown">Dropdown</option>
        <option value="select_one">Single choice</option>
        <option value="select_multiple">Multiple choice</option>
      </select>
    </label>
    <label class="q-required">
      <input type="checkbox" class="q-required-input" ${initial.required ? 'checked' : ''} />
      Required
    </label>
    <label class="q-options">
      Options (one per line)
      <textarea class="q-options-input" rows="3"></textarea>
    </label>
    <button type="button" class="remove-question">Remove</button>
  `;
  const typeSelect = wrapper.querySelector('.q-type');
  const optionsTextarea = wrapper.querySelector('.q-options-input');
  const removeBtn = wrapper.querySelector('.remove-question');

  typeSelect.value = initial.type || 'short_text';
  optionsTextarea.value = Array.isArray(initial.options) ? initial.options.join('\n') : '';
  toggleOptionsVisibility(typeSelect, optionsTextarea);

  typeSelect.addEventListener('change', () => toggleOptionsVisibility(typeSelect, optionsTextarea));
  removeBtn.addEventListener('click', () => wrapper.remove());

  questionsContainer.appendChild(wrapper);
}

function toggleOptionsVisibility(typeSelect, optionsTextarea) {
  const needsOptions = ['dropdown', 'select_one', 'select_multiple'].includes(typeSelect.value);
  optionsTextarea.parentElement.style.display = needsOptions ? 'block' : 'none';
}

async function loadForms() {
  formsListEl.innerHTML = '<li>Loading...</li>';
  try {
    const res = await fetch('/api/admin/forms');
    if (!res.ok) throw new Error('Failed to load forms');
    const data = await res.json();
    const forms = data.forms || [];
    if (forms.length === 0) {
      formsListEl.innerHTML = '<li>No forms yet</li>';
      return;
    }
    formsListEl.innerHTML = '';
    forms.forEach((f) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <strong>${f.title}</strong><br>
        Release: ${new Date(f.release_at).toLocaleString()}<br>
        Active: ${f.is_active ? 'Yes' : 'No'}
        <button type="button" data-id="${f.id}">Edit</button>
      `;
      li.querySelector('button').addEventListener('click', () => loadFormIntoBuilder(f.id));
      formsListEl.appendChild(li);
    });
  } catch (err) {
    console.error(err);
    formsListEl.innerHTML = '<li>Error loading forms</li>';
  }
}

async function loadFormIntoBuilder(id) {
  try {
    const res = await fetch(`/api/admin/forms/${id}`);
    if (!res.ok) throw new Error('Failed to load form');
    const { form } = await res.json();
    editingFormId = form.id;
    formBuilderTitle.textContent = `Editing Form #${form.id}`;
    formTitleInput.value = form.title || '';
    formDescriptionInput.value = form.description || '';
    formReleaseInput.value = form.release_at ? new Date(form.release_at).toISOString().slice(0, 16) : '';
    formActiveInput.checked = form.is_active;
    questionsContainer.innerHTML = '';
    (form.questions || []).forEach((q) => {
      addQuestionRow({
        label: q.label,
        type: q.type,
        required: q.required,
        options: Array.isArray(q.options) ? q.options : q.options || []
      });
    });
    formBuilderMessage.textContent = `Editing form #${form.id}`;
    formBuilderMessage.classList.remove('error');
  } catch (err) {
    console.error(err);
    formBuilderMessage.textContent = 'Could not load form';
    formBuilderMessage.classList.add('error');
  }
}

async function saveForm() {
  const title = formTitleInput.value.trim();
  if (!title) {
    formBuilderMessage.textContent = 'Title is required';
    formBuilderMessage.classList.add('error');
    return;
  }

  const questions = Array.from(questionsContainer.querySelectorAll('.question-row')).map(
    (row, idx) => {
      const label = row.querySelector('.q-label').value.trim();
      const type = row.querySelector('.q-type').value;
      const required = row.querySelector('.q-required-input').checked;
      const optionsRaw = row.querySelector('.q-options-input').value.split('\n');
      const options = optionsRaw.map((o) => o.trim()).filter(Boolean);
      return { label, type, required, options, sortOrder: idx };
    }
  );

  const payload = {
    title,
    description: formDescriptionInput.value,
    releaseAt: formReleaseInput.value ? new Date(formReleaseInput.value).toISOString() : null,
    isActive: formActiveInput.checked,
    questions
  };

  try {
    const method = editingFormId ? 'PUT' : 'POST';
    const url = editingFormId ? `/api/admin/forms/${editingFormId}` : '/api/admin/forms';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Failed to save form');
    }
    formBuilderMessage.textContent = editingFormId ? 'Form updated' : 'Form created';
    formBuilderMessage.classList.remove('error');
    await loadForms();
    if (!editingFormId) clearBuilder(false);
  } catch (err) {
    console.error(err);
    formBuilderMessage.textContent = err.message;
    formBuilderMessage.classList.add('error');
  }
}

addQuestionBtn?.addEventListener('click', () => addQuestionRow());
saveFormBtn?.addEventListener('click', saveForm);
newFormBtn?.addEventListener('click', () => clearBuilder(true));

clearBuilder(true);
setView('database');
