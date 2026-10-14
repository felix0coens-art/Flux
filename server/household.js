'use strict';
/*
 * Gedeelde boekhouding (huishouden). Zelfde gedrag als php/lib/household.php.
 * Wie een uitnodigingscode invult, werkt in de boekhouding van de eigenaar; zijn eigen gegevens blijven
 * bewaard en komen terug als hij het huishouden verlaat. Bankkoppelingen en sleutels blijven per persoon.
 */
const crypto = require('crypto');

const INVITE_DAYS = 7;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function create({ readJson, writeJson, withLock, getUsers, httpError }) {
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const nameOf = (users, n) => { const u = users[n] || {}; return u.displayName || (u.google && u.google.name) || n; };

  /** Wiens boekhouding gebruikt deze gebruiker? (zichzelf, of de eigenaar van zijn huishouden) */
  function dataUserSync(users, user) {
    const me = users[user];
    const owner = me && me.shareOf;
    if (!owner || owner === user) return user;
    const o = users[owner];
    if (!o || o.disabled || !(o.household || []).includes(user)) return user;
    return owner;
  }
  async function dataUser(user) { return dataUserSync(await getUsers(), user); }

  async function status(user) {
    const users = await getUsers();
    const owner = dataUserSync(users, user);
    if (owner !== user) {
      return { role: 'member', owner: { user: owner, name: nameOf(users, owner) }, members: (users[owner].household || []).filter(m => users[m]).map(m => ({ user: m, name: nameOf(users, m) })) };
    }
    const members = ((users[user] || {}).household || []).filter(m => users[m] && users[m].shareOf === user);
    return { role: members.length ? 'owner' : 'none', members: members.map(m => ({ user: m, name: nameOf(users, m) })) };
  }

  async function invite(user) {
    if (await dataUser(user) !== user) throw httpError(400, 'Je zit zelf in het huishouden van iemand anders. Verlaat dat eerst.');
    let code = '';
    for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    await withLock('household-invites', async () => {
      const p = await readJson('household-invites.json', {});
      const now = Math.floor(Date.now() / 1000);
      for (const k of Object.keys(p)) if (now - (p[k].at || 0) > INVITE_DAYS * 86400 || p[k].owner === user) delete p[k];
      p[sha(code)] = { owner: user, at: now };
      await writeJson('household-invites.json', p);
    });
    return { code: code.slice(0, 4) + '-' + code.slice(4), validDays: INVITE_DAYS };
  }

  async function join(user, b) {
    const code = String(b.code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const hit = await withLock('household-invites', async () => {
      const p = await readJson('household-invites.json', {});
      const h = p[sha(code)] || null;
      if (h) { delete p[sha(code)]; await writeJson('household-invites.json', p); }
      return h && Math.floor(Date.now() / 1000) - (h.at || 0) <= INVITE_DAYS * 86400 ? h : null;
    });
    if (!code || !hit) throw httpError(400, 'Deze code klopt niet of is verlopen. Vraag een nieuwe.');
    const owner = hit.owner;
    if (owner === user) throw httpError(400, 'Dit is je eigen uitnodiging.');
    await withLock('users', async () => {
      const users = await getUsers();
      if (!users[owner] || users[owner].disabled) throw httpError(400, 'Dit huishouden bestaat niet meer.');
      if ((users[user].household || []).length) throw httpError(400, 'Er werken al anderen in jouw boekhouding. Haal hen eerst uit je huishouden.');
      if (users[owner].role === 'admin' || users[user].role === 'admin') throw httpError(400, 'Niet mogelijk voor het beheerdersaccount.');
      users[user].shareOf = owner;
      const list = users[owner].household || [];
      if (!list.includes(user)) list.push(user);
      users[owner].household = list;
      await writeJson('users.json', users);
    });
    return status(user);
  }

  /** Verlaten (lid) of iemand eruit halen (eigenaar). */
  async function leave(user, b) {
    const target = String(b.user || user);
    await withLock('users', async () => {
      const users = await getUsers();
      if (target === user) {
        const owner = users[user].shareOf;
        delete users[user].shareOf;
        if (owner && users[owner]) users[owner].household = (users[owner].household || []).filter(m => m !== user);
      } else {
        if (!(users[user].household || []).includes(target)) throw httpError(404, 'Niet in jouw huishouden');
        users[user].household = users[user].household.filter(m => m !== target);
        if (users[target] && users[target].shareOf === user) delete users[target].shareOf;
      }
      if (users[user].household && !users[user].household.length) delete users[user].household;
      await writeJson('users.json', users);
    });
    return status(user);
  }

  return { dataUser, dataUserSync, status, invite, join, leave };
}

module.exports = { create };
