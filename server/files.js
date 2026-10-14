'use strict';
/*
 * Bonnetjes en documenten bij transacties (foto of pdf). Zelfde gedrag als php/lib/files.php.
 * Bestanden staan per gebruiker in <datamap>/files-<gebruiker>/ en zijn enkel bereikbaar via de API.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX = 6 * 1024 * 1024;
const QUOTA = 300 * 1024 * 1024;

function magicOk(type, bin) {
  if (type === 'image/jpeg') return bin[0] === 0xff && bin[1] === 0xd8 && bin[2] === 0xff;
  if (type === 'image/png') return bin.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/webp') return bin.slice(0, 4).toString('latin1') === 'RIFF' && bin.slice(8, 12).toString('latin1') === 'WEBP';
  if (type === 'application/pdf') return bin.slice(0, 5).toString('latin1') === '%PDF-';
  return false;
}

function create(dataDir, httpError) {
  const dirOf = user => path.join(dataDir, 'files-' + Buffer.from(user).toString('hex'));

  async function upload(user, b) {
    const type = String(b.type || '');
    if (!TYPES[type]) throw httpError(400, 'Enkel foto’s (jpg, png, webp) en pdf-bestanden');
    const data = String(b.data || '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw httpError(400, 'Ongeldig bestand');
    const bin = Buffer.from(data, 'base64');
    if (!bin.length) throw httpError(400, 'Ongeldig bestand');
    if (bin.length > MAX) throw httpError(413, 'Bestand te groot (max. 6 MB)');
    if (!magicOk(type, bin)) throw httpError(400, 'De inhoud van het bestand klopt niet met het type');
    const dir = dirOf(user);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    let used = 0;
    for (const f of await fsp.readdir(dir)) { try { used += (await fsp.stat(path.join(dir, f))).size; } catch (e) { /* weg */ } }
    if (used + bin.length > QUOTA) throw httpError(413, 'Je opslag voor bonnetjes is vol (300 MB)');
    const id = crypto.randomBytes(12).toString('base64url');
    const name = String(b.name || 'bestand').replace(/[\x00-\x1f/\\]/g, '').trim().slice(0, 80) || 'bestand';
    const meta = { id, name, type, size: bin.length, created: new Date().toISOString() };
    await fsp.writeFile(path.join(dir, id + '.' + TYPES[type]), bin);
    await fsp.writeFile(path.join(dir, id + '.json'), JSON.stringify(meta));
    return meta;
  }

  async function meta(user, id) {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(String(id))) return null;
    try {
      const m = JSON.parse(await fsp.readFile(path.join(dirOf(user), id + '.json'), 'utf8'));
      return m && TYPES[m.type] ? m : null;
    } catch (e) { return null; }
  }

  /** Schrijft het bestand naar de response (of 404). */
  async function send(res, user, id) {
    const m = await meta(user, id);
    const file = m ? path.join(dirOf(user), id + '.' + TYPES[m.type]) : null;
    let bin = null;
    if (file) { try { bin = await fsp.readFile(file); } catch (e) { bin = null; } }
    if (!bin) throw httpError(404, 'Bestand niet gevonden');
    res.writeHead(200, {
      'Content-Type': m.type, 'Content-Length': bin.length, 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(m.name),
      'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    });
    res.end(bin);
  }

  async function remove(user, id) {
    const m = await meta(user, id);
    if (m) {
      await fsp.unlink(path.join(dirOf(user), id + '.' + TYPES[m.type])).catch(() => {});
      await fsp.unlink(path.join(dirOf(user), id + '.json')).catch(() => {});
    }
    return { ok: true };
  }

  async function removeAll(user) {
    await fsp.rm(dirOf(user), { recursive: true, force: true }).catch(() => {});
  }

  return { upload, send, remove, removeAll };
}

module.exports = { create, TYPES, MAX };
