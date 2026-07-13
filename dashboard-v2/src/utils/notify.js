export function notify(message, type = 'success') {
  window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message, type } }));
}
