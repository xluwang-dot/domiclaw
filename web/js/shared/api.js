// Shared API helpers
// Used by app.html and admin.html

async function apiGet(path) {
  const r = await fetch(path);
  if (r.status === 401) { window.location.href = '/login.html'; return; }
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 401) { window.location.href = '/login.html'; return; }
  return r.json();
}

async function apiPut(path, body) {
  const r = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 401) { window.location.href = '/login.html'; return; }
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(path, { method: 'DELETE' });
  if (r.status === 401) { window.location.href = '/login.html'; return; }
  if (r.status === 204) return { ok: true };
  return r.json();
}
