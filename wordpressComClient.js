const API = 'https://public-api.wordpress.com';

async function request(accessToken, route, options = {}) {
  if (!accessToken) throw new Error('Connect WordPress.com first.');
  if (!/^\/(?:rest|wp|wpcom)\//.test(route) || route.includes('..')) throw new Error('WordPress.com API route is not allowed.');
  const response = await fetch(`${API}${route}`, { ...options, headers:{ Accept:'application/json', Authorization:`Bearer ${accessToken}`, ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `WordPress.com request failed (${response.status}).`);
  return data;
}

async function getProfile(token) {
  const profile = await request(token, '/rest/v1.1/me');
  return { id:profile.ID, username:profile.username || '', displayName:profile.display_name || profile.username || '', avatarUrl:profile.avatar_URL || '' };
}
async function listSites(token) {
  const data = await request(token, '/rest/v1.1/me/sites');
  return (data.sites || []).map((site) => ({ id:String(site.ID), name:site.name || site.slug || 'WordPress site', url:site.URL || '', jetpack:Boolean(site.jetpack), private:Boolean(site.is_private), capabilities:site.capabilities || {} }));
}

module.exports = { request, getProfile, listSites, API };
