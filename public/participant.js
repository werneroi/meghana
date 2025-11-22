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
let bodyMapData = null;
let bodyMapApp = null;
let bodyMapVersions = [];
const BM_STAGE_W = 450; // 50% smaller than previous
const BM_STAGE_H = 550;

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
    // preload body map
    const bm = await fetchBodyMap();
    bodyMapData = bm.latest;
    bodyMapVersions = bm.versions || [];
    formsMessage.textContent = '';
    // preload responses
    for (const form of formsCache) {
      responsesCache[form.id] = await fetchResponse(form.id);
    }
    renderSidebar();
    renderForm(selectDefault());
  } catch (err) {
    console.error(err);
    formsMessage.textContent = 'Could not load forms.';
  }
}

function selectDefault() {
  if (formsCache.length > 0) return formsCache[0];
  return null;
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

async function fetchBodyMap() {
  try {
    const res = await fetch('/api/bodymap');
    if (!res.ok) return { latest: null, versions: [] };
    const data = await res.json();
    return { latest: data.latest || null, versions: data.versions || [] };
  } catch (err) {
    return { latest: null, versions: [] };
  }
}

function renderSidebar(activeId) {
  formsSidebar.innerHTML = '';
  // Body map entry
  const bodyItem = document.createElement('li');
  bodyItem.className = 'sidebar-item';
  if (!activeId) bodyItem.classList.add('active');
  bodyItem.textContent = 'Body Map';
  bodyItem.addEventListener('click', () => {
    renderSidebar('bodymap');
    renderBodyMap();
  });
  formsSidebar.appendChild(bodyItem);

  const hasForms = formsCache.length > 0;
  if (!hasForms) {
    const li = document.createElement('li');
    li.className = 'sidebar-item';
    li.textContent = 'No forms available';
    li.style.cursor = 'default';
    formsSidebar.appendChild(li);
  }

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

// --- Body map integration ---
class BodyMapApp {
  constructor(containerEl, initialData = null, versions = []) {
    this.containerEl = containerEl;
    this.currentTool = 'brush';
    this.currentSize = 5;
    this.isDrawing = false;
    this.currentShape = null;
    this.bgImageObj = null;
    this.stage = null;
    this.bgLayer = null;
    this.drawLayer = null;
    this.versions = versions;
    this.init(initialData);
  }

  init(initialData) {
    this.buildUI();
    this.setupKonva();
    this.loadImage('body.jpg');
    if (initialData) this.loadFromData(initialData);
    if (window.lucide) window.lucide.createIcons();
  }

  buildUI() {
    this.containerEl.innerHTML = `
      <div class="bodymap-toolbar">
        <div class="tool-group">
          <button class="tool-btn active" data-tool="brush" title="Brush"><i data-lucide="pencil"></i></button>
          <button class="tool-btn" data-tool="eraser" title="Eraser"><i data-lucide="eraser"></i></button>
          <button class="tool-btn" data-action="clear" title="Clear"><i data-lucide="trash-2"></i></button>
        </div>
        <div class="tool-group">
          <label class="small-label">Color</label>
          <input type="color" id="strokeColor" value="#df4b26">
        </div>
        <div class="tool-group">
          <label class="small-label">Brush Size</label>
          <div class="size-group">
            ${[2,5,12,24,36].map((s, idx) => `
              <button class="size-btn ${s===5?'active':''}" data-size="${s}" title="${s}px">
                <span style="width:${Math.min(s,18)}px;height:${Math.min(s,18)}px;"></span>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="tool-group">
          <label class="small-label" for="bodymap-version-select">Load</label>
          <select id="bodymap-version-select"></select>
          <button id="loadBodyMap" class="tool-btn">Load</button>
        </div>
        <div class="tool-group">
          <button id="saveBodyMap" class="primary-btn">Save</button>
          <span class="message" id="bodymap-message"></span>
        </div>
      </div>
      <div id="bodymap-canvas" class="bodymap-canvas">
        <div class="bodymap-grid"></div>
      </div>
    `;
    this.canvasEl = this.containerEl.querySelector('#bodymap-canvas');
    // lock canvas size to stage constants
    this.canvasEl.style.width = `${BM_STAGE_W}px`;
    this.canvasEl.style.height = `${BM_STAGE_H}px`;
    this.messageEl = this.containerEl.querySelector('#bodymap-message');
    this.versionSelect = this.containerEl.querySelector('#bodymap-version-select');

    // tool events
    this.containerEl.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'clear') {
          if (confirm('Clear all drawings?')) {
            this.drawLayer.destroyChildren();
            this.drawLayer.batchDraw();
          }
          return;
        }
        this.containerEl.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
      });
    });

    this.containerEl.querySelectorAll('.size-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.containerEl.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentSize = Number(btn.dataset.size);
      });
    });

    this.containerEl.querySelector('#saveBodyMap').addEventListener('click', () => this.save());
    this.containerEl.querySelector('#loadBodyMap').addEventListener('click', () => this.loadSelectedVersion());

    this.renderVersionOptions();
  }

  setupKonva() {
    this.stage = new Konva.Stage({
      container: this.canvasEl,
      width: BM_STAGE_W,
      height: BM_STAGE_H
    });
    this.bgLayer = new Konva.Layer({ listening: false });
    this.drawLayer = new Konva.Layer();
    this.stage.add(this.bgLayer);
    this.stage.add(this.drawLayer);
    this.drawLayer.getCanvas()._canvas.style.opacity = '0.6';

    this.stage.on('mousedown touchstart', (e) => this.handleMouseDown(e));
    this.stage.on('mousemove touchmove', (e) => this.handleMouseMove(e));
    this.stage.on('mouseup touchend', () => this.handleMouseUp());
  }

  handleMouseDown(e) {
    if (e.evt.button !== undefined && e.evt.button !== 0) return;
    this.isDrawing = true;
    const pos = this.stage.getPointerPosition();
    const isEraser = this.currentTool === 'eraser';

    this.currentShape = new Konva.Line({
      stroke: isEraser ? '#000000' : this.strokeColor,
      strokeWidth: this.currentSize,
      globalCompositeOperation: isEraser ? 'destination-out' : 'source-over',
      points: [pos.x, pos.y, pos.x, pos.y],
      tension: 0.5,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false
    });
    this.drawLayer.add(this.currentShape);
  }

  handleMouseMove(e) {
    if (!this.isDrawing || !this.currentShape) return;
    e.evt.preventDefault();
    const pos = this.stage.getPointerPosition();
    const newPoints = this.currentShape.points().concat([pos.x, pos.y]);
    this.currentShape.points(newPoints);
  }

  handleMouseUp() {
    this.isDrawing = false;
    this.currentShape = null;
  }

  get strokeColor() {
    return this.containerEl.querySelector('#strokeColor').value;
  }

  handleResize() {
    // noop; stage is fixed size
  }

  loadImage(url) {
    const imgObj = new Image();
    imgObj.src = url;
    imgObj.crossOrigin = 'Anonymous';
    imgObj.onload = () => {
      this.bgImageObj = imgObj;
      this.bgLayer.destroyChildren();
      const kImage = new Konva.Image({ image: imgObj });
      this.bgLayer.add(kImage);
      this.fitImageToStage(kImage, imgObj);
      this.bgLayer.batchDraw();
    };
  }

  fitImageToStage(kImage, imgObj) {
    if (!imgObj) return;
    const stageW = this.stage.width();
    const stageH = this.stage.height();
    const scale = Math.min(stageW / imgObj.width, stageH / imgObj.height);
    const w = imgObj.width * scale;
    const h = imgObj.height * scale;
    kImage.width(w);
    kImage.height(h);
    kImage.x((stageW - w) / 2);
    kImage.y((stageH - h) / 2);
  }

  loadFromData(data) {
    try {
      const layerJson = data?.layerJson;
      const layerData = data?.layer || data;
      this.drawLayer.destroyChildren();
      const tempLayer = layerJson
        ? Konva.Node.create(layerJson)
        : Konva.Node.create(JSON.stringify(layerData));
      const children = tempLayer.getChildren();
      console.log("participant.js children: ", children);
      [...children].forEach((child) => {
        console.log("participant.js child: ", child);
        child.moveTo(this.drawLayer);
        child.listening(false);
      });
      this.drawLayer.batchDraw();
    } catch (err) {
      console.error('Failed to load saved body map', err);
    }
  }

  async save() {
    this.messageEl.textContent = 'Saving...';
    try {
      const layerJson = this.drawLayer.toJSON();
      const payload = {
        layerJson,
        stage: {
          width: this.stage.width(),
          height: this.stage.height()
        }
      };
      const res = await fetch('/api/bodymap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      this.messageEl.textContent = 'Saved';
      // refresh versions
      const latest = await fetchBodyMap();
      bodyMapData = latest.latest;
      bodyMapVersions = latest.versions;
      this.versions = bodyMapVersions;
      this.renderVersionOptions();
    } catch (err) {
      console.error(err);
      this.messageEl.textContent = err.message;
      this.messageEl.classList.add('error');
    }
  }

  async loadSelectedVersion() {
    const id = this.versionSelect.value;
    if (!id) return;
    this.messageEl.textContent = 'Loading...';
    try {
      const res = await fetch(`/api/bodymap/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      this.loadFromData(data.data);
      this.messageEl.textContent = 'Loaded';
    } catch (err) {
      console.error(err);
      this.messageEl.textContent = err.message;
      this.messageEl.classList.add('error');
    }
  }

  renderVersionOptions() {
    if (!this.versionSelect) return;
    this.versionSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = this.versions && this.versions.length ? 'Select version' : 'No versions';
    this.versionSelect.appendChild(placeholder);
    (this.versions || []).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = formatDate(v.created_at);
      this.versionSelect.appendChild(opt);
    });
  }
}

function renderBodyMap() {
  formStage.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'form-card';
  const title = document.createElement('h3');
  title.textContent = 'Body Map';
  const desc = document.createElement('p');
  desc.textContent = 'Draw on the body map to indicate areas. Use save to store your drawing.';
  const mount = document.createElement('div');
  mount.id = 'bodymap-mount';
  mount.className = 'bodymap-wrapper';
  wrapper.appendChild(title);
  wrapper.appendChild(desc);
  wrapper.appendChild(mount);
  formStage.appendChild(wrapper);

  bodyMapApp = new BodyMapApp(mount, bodyMapData, bodyMapVersions);
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch (err) {
    return ts;
  }
}

// init
loadForms();
