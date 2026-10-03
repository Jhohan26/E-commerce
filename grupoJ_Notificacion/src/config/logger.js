export const logger = {
  info(action, details = {}) { console.log(JSON.stringify({ nivel: 'info', fecha: new Date().toISOString(), accion: action, ...details })); },
  error(action, details = {}) { console.error(JSON.stringify({ nivel: 'error', fecha: new Date().toISOString(), accion: action, ...details })); }
};
