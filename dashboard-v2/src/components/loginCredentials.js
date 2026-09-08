export function loginCredentialsFromFormData(values) {
  return {
    username: String(values.get('username') || '').trim(),
    // Passwords are intentionally neither trimmed nor otherwise transformed.
    password: String(values.get('password') || ''),
  };
}

export function loginCredentialsFromForm(form) {
  return loginCredentialsFromFormData(new FormData(form));
}
