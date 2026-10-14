#!/usr/bin/env node
'use strict';
/*
 * Voegt de stukken in js/app/ (op volgorde van hun nummer) samen tot js/app.js.
 * De stukken zijn samen één script (één functie die de hele app bevat); apart zijn ze geen geldig JavaScript.
 *
 *   node scripts/build-app.js          js/app.js opnieuw maken
 *   node scripts/build-app.js --check  enkel controleren of js/app.js nog klopt (voor de tests)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'js', 'app');

function build() {
  const files = fs.readdirSync(dir).filter(f => /^\d{2}-[a-z0-9-]+\.js$/.test(f)).sort();
  return files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}

if (require.main === module) {
  const out = build();
  const target = path.join(root, 'js', 'app.js');
  if (process.argv.includes('--check')) {
    const ok = fs.readFileSync(target, 'utf8') === out;
    console.log(ok ? 'js/app.js is up-to-date' : 'js/app.js is NIET up-to-date: voer "npm run build:app" uit');
    process.exit(ok ? 0 : 1);
  }
  fs.writeFileSync(target, out);
  console.log('js/app.js gemaakt uit ' + fs.readdirSync(dir).filter(f => f.endsWith('.js')).length + ' stukken');
}

module.exports = { build };
