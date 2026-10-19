'use strict';
(() => {
  const form = document.getElementById('auth-form');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const status = document.getElementById('auth-status');
    const field = document.getElementById('token');
    button.disabled = true;
    status.textContent = 'Validando acceso…';
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {'Authorization': 'Bearer ' + field.value.trim(), 'Accept': 'application/json'},
        body: new URLSearchParams({csrf: form.elements.csrf.value})
      });
      field.value = '';
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'No fue posible autenticar.');
      window.location.replace('./');
    } catch (error) {
      status.textContent = error.message || 'No fue posible autenticar.';
      button.disabled = false;
    }
  });
})();