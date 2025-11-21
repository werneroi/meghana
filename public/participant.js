const logoutBtn = document.getElementById('logout-btn');
const socketStatus = document.getElementById('socket-status');
const pingBtn = document.getElementById('ping-btn');
const pongResult = document.getElementById('pong-result');

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
