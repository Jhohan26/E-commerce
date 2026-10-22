'use strict';

(() => {
  const bindForm = (
    formId,
    statusId,
    fieldsToClear
  ) => {
    const form = document.getElementById(formId);

    if (!form) return;

    form.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const button = form.querySelector('button');
        const status = document.getElementById(statusId);

        button.disabled = true;
        status.textContent = 'Validando acceso…';

        const body = new URLSearchParams();

        new FormData(form).forEach(
          (value, key) => {
            body.append(key, String(value));
          }
        );

        try {
          const response = await fetch(
            form.action,
            {
              method: 'POST',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: {
                'Accept': 'application/json'
              },
              body
            }
          );

          const result = await response.json();

          if (!response.ok) {
            throw new Error(
              result.message
              || 'No fue posible autenticar.'
            );
          }

          for (const fieldId of fieldsToClear) {
            const field = document.getElementById(fieldId);

            if (field) {
              field.value = '';
            }
          }

          window.location.replace('./');

        } catch (error) {
          status.textContent =
            error.message
            || 'No fue posible autenticar.';

          button.disabled = false;
        }
      }
    );
  };

  bindForm(
    'auth-form',
    'auth-status',
    ['password']
  );

  bindForm(
    'auth-token-form',
    'token-auth-status',
    ['token']
  );
})();