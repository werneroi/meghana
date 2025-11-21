const tableBody = document.querySelector('#participants-table tbody');
const adminMessage = document.getElementById('admin-message');
const logoutBtn = document.getElementById('logout-btn');

async function loadParticipants() {
  try {
    const res = await fetch('/api/admin/participants');
    if (res.status === 403 || res.status === 401) {
      window.location.href = '/';
      return;
    }
    const json = await res.json();
    const participants = json.participants || [];

    tableBody.innerHTML = '';
    participants.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.id}</td>
        <td>${p.code}</td>
        <td>${p.email}</td>
        <td>${p.age ?? ''}</td>
        <td>${p.sex ?? ''}</td>
        <td>${p.gender ?? ''}</td>
        <td>${p.gender_other ?? ''}</td>
        <td>${new Date(p.created_at).toLocaleString()}</td>
      `;
      tableBody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    adminMessage.textContent = 'Error loading participants';
    adminMessage.classList.add('error');
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

loadParticipants();
