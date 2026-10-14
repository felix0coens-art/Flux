/*
 * Helder — synchronisatie met de Helder-server.
 *
 * Werkt "offline first": de app werkt altijd met de kopie in deze browser. Wijzigingen worden
 * gemarkeerd als "dirty" en op de achtergrond naar de server gestuurd; wijzigingen van andere
 * toestellen worden binnengehaald en samengevoegd (per object de nieuwste versie).
 * Als de app zonder server geopend wordt (bv. index.html dubbelklikken) blijft alles lokaal.
 */
(function (root) {
  'use strict';
  const C = root.FluxCore;
  const META_KEY = 'flux-sync-v1';
  const POLL_MS = 60000;
  const SCHEMA = root.FluxStore.VERSION;

  let opts = null;
  let meta = loadMeta();
  let mode = 'local'; // local | server | offline | auth
  let status = 'idle'; // idle | syncing | ok | error | offline
  let lastSync = meta.lastSync || null;
  let features = {};
  let authInfo = {};
  let account = null;
  let pushTimer = null, pollTimer = null, inFlight = null, seq = 0;

  function loadMeta() {
    try {
      const m = Object.assign({ user: null, rev: 0, dirty: {} }, JSON.parse(localStorage.getItem(META_KEY) || '{}'));
      // Na een update van het gegevensschema: niets ouds meer versturen, alles opnieuw ophalen
      if (m.schema !== SCHEMA) return { user: m.user, rev: 0, dirty: {}, schema: SCHEMA };
      return m;
    } catch (e) { return { user: null, rev: 0, dirty: {}, schema: SCHEMA }; }
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* negeren */ }
  }

  function setStatus(s, detail) {
    status = s;
    if (opts && opts.onStatus) opts.onStatus({ mode, status, detail, user: meta.user, lastSync, pending: Object.keys(meta.dirty).length, features });
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: Object.assign({ 'X-Flux': '1' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* geen json */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    if (!data) { const err = new Error('Geen Helder-server'); err.status = 0; throw err; }
    return data;
  }

  /** Neemt de staat van de server over, met lokale nog niet verstuurde wijzigingen erbovenop. */
  function applyServerState(serverState) {
    if (!serverState) return;
    const local = opts.getState();
    const pending = C.extractChanges(local, Object.keys(meta.dirty));
    const merged = C.mergeStates(serverState, pending);
    opts.setState(merged);
  }

  async function syncNow() {
    if (mode !== 'server' && mode !== 'offline') return;
    if (inFlight) { schedulePush(300); return inFlight; }
    inFlight = (async () => {
      setStatus('syncing');
      const sent = Object.assign({}, meta.dirty);
      const keys = Object.keys(sent);
      const changes = keys.length ? C.extractChanges(opts.getState(), keys) : null;
      try {
        const res = await api('POST', '/api/sync', { changes, rev: meta.rev, schema: SCHEMA });
        for (const k of keys) if (meta.dirty[k] === sent[k]) delete meta.dirty[k];
        if (res.state) applyServerState(res.state);
        meta.rev = res.rev;
        lastSync = meta.lastSync = Date.now();
        mode = 'server';
        saveMeta();
        setStatus('ok');
      } catch (e) {
        if (e.status === 401) { mode = 'auth'; setStatus('error', 'Opnieuw aanmelden nodig'); opts.onAuthRequired({ setupRequired: false }); }
        else if (e.status === 409) { mode = 'server'; setStatus('error', e.message); if (opts.onOutdated) opts.onOutdated(e.message); }
        else { mode = 'offline'; setStatus('offline', e.message); }
      }
    })();
    try { await inFlight; } finally { inFlight = null; }
    if (Object.keys(meta.dirty).length && mode === 'server') schedulePush(1500);
  }

  function schedulePush(ms) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, ms == null ? 1200 : ms);
  }

  /** Door de app aangeroepen na elke wijziging (sleutels uit FluxCore.stampChanges). */
  function noteChanges(keys) {
    if (mode === 'local' || !keys || !keys.length) return;
    for (const k of keys) meta.dirty[k] = ++seq + '-' + Date.now();
    saveMeta();
    setStatus(status);
    if (mode === 'server' || mode === 'offline') schedulePush();
  }

  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    window.addEventListener('online', () => { if (mode === 'offline') recheck(); else if (mode === 'server') syncNow(); });
  }

  function startPolling() {
    listen();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, POLL_MS);
  }

  /** Na aanmelden: lokale gegevens en accountgegevens in orde brengen. */
  async function afterLogin(user) {
    const server = await api('GET', '/api/data');
    const local = opts.getState();
    const localHasData = local.transactions.length > 0;
    const sameUser = meta.user === user;
    if (!sameUser) meta = { user, rev: 0, dirty: {}, schema: SCHEMA };
    mode = 'server';

    if (!server.state) {
      // Nieuw account: lokale gegevens (indien gewenst) uploaden
      let base = local;
      if (localHasData && !sameUser && !confirm('Er staan al gegevens in deze browser. Wil je die in je nieuwe Helder-account zetten?\n\nKies "Annuleren" om met een leeg account te beginnen.')) {
        base = opts.freshState();
      }
      opts.setState(base, { stampAll: true });
    } else if (sameUser) {
      applyServerState(server.state);
    } else if (localHasData && confirm('Er staan al gegevens in deze browser. Samenvoegen met je account?\n\nKies "Annuleren" om enkel de gegevens van je account te gebruiken.')) {
      opts.setState(C.mergeStates(server.state, local), { stampAll: true });
    } else {
      opts.setState(server.state);
    }
    meta.rev = sameUser ? meta.rev : server.rev;
    saveMeta();
    startPolling();
    await syncNow();
  }

  async function init(o) {
    opts = o;
    if (!/^https?:$/.test(location.protocol)) { mode = 'local'; setStatus('idle'); return mode; }
    let session;
    try {
      session = await api('GET', '/api/session');
    } catch (e) {
      // Geen server bereikbaar: offline verder met de lokale kopie als we al ooit synchroniseerden
      mode = meta.user ? 'offline' : 'local';
      setStatus(meta.user ? 'offline' : 'idle', e.message);
      if (meta.user) startPolling();
      return mode;
    }
    features = session.features || {};
    authInfo = session.auth || {};
    account = session.user ? session : null;
    if (!session.user) {
      mode = 'auth';
      setStatus('idle');
      opts.onAuthRequired({ setupRequired: session.setupRequired, setupHint: session.setupHint, previousUser: meta.user, auth: authInfo });
      return mode;
    }
    if (session.role === 'admin') { mode = 'admin'; setStatus('idle'); opts.onAdmin(session); return mode; }
    await afterLogin(session.user);
    return mode;
  }

  async function recheck() {
    try {
      const session = await api('GET', '/api/session');
      features = session.features || {};
      if (session.user) { mode = 'server'; await syncNow(); }
      else { mode = 'auth'; opts.onAuthRequired({ setupRequired: session.setupRequired, setupHint: session.setupHint, previousUser: meta.user, auth: session.auth || {} }); }
    } catch (e) { /* nog steeds offline */ }
  }

  async function login(username, password) {
    const r = await api('POST', '/api/login', { username, password });
    await refreshFeatures();
    account = r;
    if (r.role === 'admin') { mode = 'admin'; opts.onAdmin(r); return r.user; }
    await afterLogin(r.user);
    return r.user;
  }

  async function register(username, password, displayName) {
    const r = await api('POST', '/api/register', { username, password, displayName });
    await refreshFeatures();
    account = r;
    await afterLogin(r.user);
    return r.user;
  }

  async function setup(code, username, password) {
    const r = await api('POST', '/api/setup', { code, username, password });
    await refreshFeatures();
    await afterLogin(r.user);
    return r.user;
  }

  async function refreshFeatures() {
    try { const s = await api('GET', '/api/session'); features = s.features || {}; authInfo = s.auth || {}; account = s.user ? s : account; } catch (e) { /* later */ }
  }

  async function logout(everywhere) {
    if (Object.keys(meta.dirty).length && mode === 'server') await syncNow();
    if (Object.keys(meta.dirty).length && !confirm('Er zijn nog wijzigingen die niet naar de server gestuurd zijn. Toch afmelden? Die wijzigingen gaan dan verloren.')) return false;
    try { await api('POST', '/api/logout', { everywhere: !!everywhere }); } catch (e) { /* toch lokaal afmelden */ }
    clearInterval(pollTimer);
    meta = { user: null, rev: 0, dirty: {}, schema: SCHEMA };
    saveMeta();
    mode = 'auth';
    return true;
  }

  /** Eigen account verwijderen (enkel voor accounts via Google). */
  async function deleteAccount() {
    await api('POST', '/api/account/delete', { confirm: 'VERWIJDER' });
    clearInterval(pollTimer);
    meta = { user: null, rev: 0, dirty: {}, schema: SCHEMA };
    saveMeta();
    mode = 'auth';
    account = null;
  }

  async function changePassword(current, password) {
    return api('POST', '/api/password', { current, password });
  }

  async function lookup(body) {
    return api('POST', '/api/lookup', body);
  }

  /** Historische koersen (via de server) om de waarde van je beleggingen te reconstrueren. */
  async function prices(instruments) {
    return api('POST', '/api/prices', { instruments });
  }

  /** Haalt je Degiro-gegevens op via de Helder-server. Inloggegevens worden niet bewaard. */
  async function degiro(username, password, otp) {
    return api('POST', '/api/degiro/sync', { username, password, otp });
  }

  /** Bankkoppeling (Enable Banking): de server bewaart de sleutel en de toestemmingen. */
  const bank = {
    status: () => api('GET', '/api/bank/status'),
    saveConfig: (appId, privateKey) => api('POST', '/api/bank/config', { appId, privateKey }),
    removeConfig: () => api('POST', '/api/bank/config', { remove: true }),
    aspsps: country => api('GET', '/api/bank/aspsps?country=' + encodeURIComponent(country || 'BE')),
    connect: (aspsp, country, maxDays) => api('POST', '/api/bank/connect', { aspsp, country, maxDays }),
    fetch: (connectionId, accountUid, dateFrom) => api('POST', '/api/bank/fetch', { connectionId, accountUid, dateFrom }),
    disconnect: connectionId => api('POST', '/api/bank/disconnect', { connectionId })
  };

  /** Saxo Bank (OpenAPI): de server bewaart App Key, Secret en de (kortlevende) toegangssleutels. */
  const saxo = {
    status: () => api('GET', '/api/saxo/status'),
    saveConfig: (appKey, appSecret, env) => api('POST', '/api/saxo/config', { appKey, appSecret, env }),
    removeConfig: () => api('POST', '/api/saxo/config', { remove: true }),
    connect: () => api('POST', '/api/saxo/connect', {}),
    fetch: fromDate => api('POST', '/api/saxo/fetch', { fromDate }),
    disconnect: () => api('POST', '/api/saxo/disconnect', {})
  };

  /** Beheer (enkel voor het beheerdersaccount). */
  const admin = {
    overview: () => api('GET', '/api/admin/overview'),
    setRegistration: open => api('POST', '/api/admin/site', { registrationOpen: !!open }),
    user: (username, action) => api('POST', '/api/admin/user', { username, action })
  };

  root.FluxSync = {
    init, syncNow, noteChanges, login, register, setup, logout, changePassword, deleteAccount, lookup, degiro, prices, bank, saxo, admin,
    get auth() { return authInfo; },
    get account() { return account; },
    get mode() { return mode; },
    get user() { return meta.user; },
    get features() { return features; },
    get pending() { return Object.keys(meta.dirty).length; },
    get lastSync() { return lastSync; }
  };
})(window);
