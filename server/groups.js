'use strict';
/*
 * Groepen (zoals Tricount). Zelfde gedrag als php/lib/groups.php.
 * Een groep is te openen met een lange geheime link (/g#token), zonder aanmelden. Op de server staat
 * enkel de hash van die token in de bestandsnaam. Bezoekers zien enkel die ene groep, nooit het account.
 */
const crypto = require('crypto');
const G = require('../js/groups.js');

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const WRITE_LIMIT = 300; // wijzigingen per uur per IP-adres

function create({ readJson, writeJson, withLock, remove, listFiles, httpError }) {
  const fileOf = token => 'group-' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 32) + '.json';
  const writes = new Map();

  async function load(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw httpError(404, 'Deze groep bestaat niet (meer). Vraag een nieuwe link.');
    const g = await readJson(fileOf(token), null);
    if (!g) throw httpError(404, 'Deze groep bestaat niet (meer). Vraag een nieuwe link.');
    return g;
  }

  async function createGroup(owner, b) {
    let g;
    try { g = G.createGroup(b, Date.now()); } catch (e) { if (e instanceof G.GroupError) throw httpError(400, e.message); throw e; }
    g.owner = owner;
    const token = crypto.randomBytes(24).toString('base64url');
    await writeJson(fileOf(token), g);
    return { token, group: G.publicGroup(g) };
  }

  async function removeGroup(owner, b) {
    const token = b && b.token;
    return withLock('group:' + String(token), async () => {
      const g = await load(token);
      if (g.owner !== owner) throw httpError(403, 'Enkel wie de groep maakte, kan ze verwijderen.');
      await remove(fileOf(token));
      return { ok: true };
    });
  }

  /** Nieuwe geheime link; de oude werkt daarna niet meer (enkel de eigenaar). */
  async function rotate(owner, b) {
    const token = b && b.token;
    return withLock('group:' + String(token), async () => {
      const g = await load(token);
      if (g.owner !== owner) throw httpError(403, 'Enkel wie de groep maakte, kan de link vernieuwen.');
      const fresh = crypto.randomBytes(24).toString('base64url');
      await writeJson(fileOf(fresh), g);
      await remove(fileOf(token));
      return { token: fresh };
    });
  }

  /** Alle groepen van een account wissen (bij het verwijderen van dat account). */
  async function removeOwned(owner) {
    let n = 0;
    for (const f of (await listFiles()).filter(f => /^group-[0-9a-f]{32}\.json$/.test(f))) {
      const g = await readJson(f, null);
      if (g && g.owner === owner) { await remove(f); n++; }
    }
    return n;
  }

  async function publicLoad(b) { return G.publicGroup(await load(b && b.t)); }

  async function publicOp(ip, b) {
    b = b && typeof b === 'object' ? b : {};
    const now = Date.now();
    const list = (writes.get(ip) || []).filter(t => now - t < 3600000);
    if (list.length >= WRITE_LIMIT) throw httpError(429, 'Te veel wijzigingen na elkaar. Probeer binnen een uur opnieuw.');
    list.push(now);
    writes.set(ip, list);
    return withLock('group:' + String(b.t), async () => {
      const g = await load(b.t);
      let r;
      try { r = G.applyOp(g, String(b.op || ''), b.data, b.actor == null ? null : String(b.actor), now); } catch (e) { if (e instanceof G.GroupError) throw httpError(400, e.message); throw e; }
      await writeJson(fileOf(b.t), r.group);
      return { group: G.publicGroup(r.group), result: r.result };
    });
  }

  return { createGroup, removeGroup, rotate, removeOwned, publicLoad, publicOp };
}

module.exports = { create };
