const encoder = new TextEncoder();
export const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
export const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

export async function passwordHash(password: string, salt: string, pepper: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256'}, key, 256);
  const serverKey = await crypto.subtle.importKey('raw', encoder.encode(pepper), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', serverKey, derived));
}

export function equalHash(left: string, right: string) {
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return difference === 0;
}
