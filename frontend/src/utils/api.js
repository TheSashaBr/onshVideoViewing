/**
 * Shared API URL resolver for connecting to the backend.
 */
export function getApiUrl() {
  let envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    envUrl = envUrl.replace(/\/+$/, '');
    if (envUrl.includes('onsh-backend.onrender.com')) {
      return 'https://onshvideoviewing.onrender.com';
    }
    return envUrl;
  }
  const protocol = window.location.protocol;
  const hostname = window.location.hostname || 'localhost';

  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.');

  if (!isLocal) {
    return 'https://onshvideoviewing.onrender.com';
  }

  return `${protocol}//${hostname}:3001`;
}

export const API_URL = getApiUrl();
