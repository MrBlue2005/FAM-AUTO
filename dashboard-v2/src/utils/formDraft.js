export function loadFormDraft(key, fallbackFactory) {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallbackFactory();
  } catch {
    return fallbackFactory();
  }
}

export function saveFormDraft(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function clearFormDraft(key) {
  window.localStorage.removeItem(key);
}
