<?php
/*
 * Groepen (zoals Tricount). Zelfde gedrag als server/groups.js en js/groups.js.
 * Een groep is te openen met een lange geheime link (/g#token), zonder aanmelden. Op de server staat
 * enkel de hash van die token in de bestandsnaam. Bezoekers zien enkel die ene groep, nooit het account.
 */

declare(strict_types=1);

const GROUP_LIMITS = ['members' => 50, 'expenses' => 3000, 'payments' => 3000, 'name' => 40, 'title' => 80, 'groupName' => 60, 'note' => 120, 'amount' => 100000000];
const GROUP_WRITE_LIMIT = 300; // wijzigingen per uur per IP-adres

function group_file(string $token): string { return 'group-' . substr(hash('sha256', $token), 0, 32) . '.json'; }
function group_fail(string $msg): void { throw new HttpError(400, $msg); }
function group_new_id(string $prefix): string {
    $abc = '0123456789abcdefghijklmnopqrstuvwxyz';
    $r = '';
    for ($i = 0; $i < 6; $i++) $r .= $abc[random_int(0, 35)];
    return $prefix . '_' . base_convert((string) now_ms(), 10, 36) . $r;
}
function group_clean($s, int $max): string {
    if (!is_string($s) && !is_int($s) && !is_float($s)) return '';
    $s = preg_replace('/[\x{0000}-\x{001f}\x{007f}]/u', ' ', (string) $s) ?? '';
    $s = trim(preg_replace('/(*UCP)\s+/u', ' ', $s) ?? '');
    return trim(mb_substr($s, 0, $max));
}
function group_valid_date($d): bool {
    if (!is_string($d) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m)) return false;
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}
function group_valid_amount($a): bool { return is_int($a) && $a >= 1 && $a <= GROUP_LIMITS['amount']; }
function group_member_ids(array $g): array { return array_map(fn($m) => $m['id'], $g['members'] ?? []); }
function group_valid_id($id): bool { return is_string($id) && preg_match('/^[A-Za-z0-9_-]{4,40}$/', $id) === 1; }

/** Wat elk lid van een uitgave draagt; gelijk verdeeld: de overschietende centen gaan naar de eersten. */
function group_shares(array $e): array {
    $out = [];
    $sp = $e['split'] ?? [];
    if (($sp['mode'] ?? '') === 'amounts') {
        foreach ($sp['amounts'] ?? [] as $id => $v) if ($v > 0) $out[(string) $id] = $v;
        return $out;
    }
    $among = $sp['among'] ?? [];
    if (!$among) return $out;
    $base = intdiv($e['amount'], count($among));
    $rest = $e['amount'] - $base * count($among);
    foreach ($among as $id) { $out[$id] = $base + ($rest > 0 ? 1 : 0); if ($rest > 0) $rest--; }
    return $out;
}

function group_member_name($name, array $g, ?string $except): string {
    $n = group_clean($name, GROUP_LIMITS['name']);
    if ($n === '') group_fail('Geef een naam.');
    foreach ($g['members'] ?? [] as $m) if ($m['id'] !== $except && mb_strtolower($m['name']) === mb_strtolower($n)) group_fail('Er is al iemand met de naam ' . $n . '.');
    return $n;
}

function group_norm_expense($raw, array $g): array {
    $raw = is_array($raw) ? $raw : [];
    $ids = group_member_ids($g);
    $title = group_clean($raw['title'] ?? '', GROUP_LIMITS['title']);
    if ($title === '') group_fail('Waarvoor was het? Vul een omschrijving in.');
    $amount = $raw['amount'] ?? null;
    if (!group_valid_amount($amount)) group_fail('Vul een geldig bedrag in.');
    if (!group_valid_date($raw['date'] ?? null)) group_fail('Kies een geldige datum.');
    if (!in_array($raw['paidBy'] ?? null, $ids, true)) group_fail('Kies wie betaald heeft.');
    $sp = is_array($raw['split'] ?? null) ? $raw['split'] : [];
    if (($sp['mode'] ?? '') === 'amounts') {
        $amounts = [];
        $sum = 0;
        foreach (is_array($sp['amounts'] ?? null) ? $sp['amounts'] : [] as $id => $v) {
            $id = (string) $id;
            if (!in_array($id, $ids, true)) group_fail('Onbekend lid in de verdeling.');
            if (!is_int($v) || $v < 0 || $v > GROUP_LIMITS['amount']) group_fail('Ongeldig bedrag in de verdeling.');
            if ($v > 0) { $amounts[$id] = $v; $sum += $v; }
        }
        if (!$amounts) group_fail('Duid aan voor wie het was.');
        $fmt = fn($c) => str_replace('.', ',', number_format($c / 100, 2, '.', ''));
        if ($sum !== $amount) group_fail('De verdeling (' . $fmt($sum) . ') is niet gelijk aan het bedrag (' . $fmt($amount) . ').');
        $split = ['mode' => 'amounts', 'amounts' => $amounts];
    } else {
        $among = [];
        foreach (is_array($sp['among'] ?? null) ? $sp['among'] : [] as $id) {
            if (!in_array($id, $ids, true)) group_fail('Onbekend lid in de verdeling.');
            if (!in_array($id, $among, true)) $among[] = $id;
        }
        if (!$among) group_fail('Duid aan voor wie het was.');
        $split = ['mode' => 'equal', 'among' => $among];
    }
    $out = ['title' => $title, 'amount' => $amount, 'date' => $raw['date'], 'paidBy' => $raw['paidBy'], 'split' => $split];
    $note = group_clean($raw['note'] ?? '', GROUP_LIMITS['note']);
    if ($note !== '') $out['note'] = $note;
    if (group_valid_id($raw['txId'] ?? null)) $out['txId'] = $raw['txId'];
    return $out;
}

function group_norm_payment($raw, array $g): array {
    $raw = is_array($raw) ? $raw : [];
    $ids = group_member_ids($g);
    if (!in_array($raw['from'] ?? null, $ids, true) || !in_array($raw['to'] ?? null, $ids, true)) group_fail('Kies wie betaalde en wie het geld kreeg.');
    if ($raw['from'] === $raw['to']) group_fail('Iemand kan zichzelf niet terugbetalen.');
    if (!group_valid_amount($raw['amount'] ?? null)) group_fail('Vul een geldig bedrag in.');
    if (!group_valid_date($raw['date'] ?? null)) group_fail('Kies een geldige datum.');
    $out = ['from' => $raw['from'], 'to' => $raw['to'], 'amount' => $raw['amount'], 'date' => $raw['date']];
    $note = group_clean($raw['note'] ?? '', GROUP_LIMITS['note']);
    if ($note !== '') $out['note'] = $note;
    return $out;
}

function group_in_use(array $g, string $id): bool {
    foreach ($g['expenses'] as $e) if ($e['paidBy'] === $id || isset(group_shares($e)[$id]) || in_array($id, $e['split']['among'] ?? [], true)) return true;
    foreach ($g['payments'] as $p) if ($p['from'] === $id || $p['to'] === $id) return true;
    return false;
}

/** Voert één wijziging uit op een groep (zelfde als applyOp in js/groups.js). */
function group_apply_op(array $g, string $op, $data, ?string $actor, int $now): array {
    $data = is_array($data) ? $data : [];
    $ids = group_member_ids($g);
    if ($op !== 'member.add' && !in_array($actor, $ids, true)) group_fail('Kies eerst wie je bent.');
    if ($actor !== null && $actor !== '' && !in_array($actor, $ids, true)) group_fail('Kies eerst wie je bent.');
    $by = in_array($actor, $ids, true) ? $actor : null;
    $pick = function (string $prefix, array $list) use ($data): string {
        $id = group_valid_id($data['id'] ?? null) ? $data['id'] : null;
        if ($id !== null) foreach ($list as $x) if ($x['id'] === $id) { $id = null; break; }
        return $id ?? group_new_id($prefix);
    };
    $find = function (array $list, $id): ?int { foreach ($list as $i => $x) if ($x['id'] === $id) return $i; return null; };
    $result = null;
    if ($op === 'member.add') {
        if (count($g['members']) >= GROUP_LIMITS['members']) group_fail('Deze groep is vol.');
        $name = group_member_name($data['name'] ?? '', $g, null);
        $m = ['id' => $pick('m', $g['members']), 'name' => $name, 'createdAt' => $now];
        $g['members'][] = $m;
        $result = $m['id'];
    } elseif ($op === 'member.rename') {
        $i = $find($g['members'], $data['id'] ?? null);
        if ($i === null) group_fail('Dit lid bestaat niet meer.');
        $g['members'][$i]['name'] = group_member_name($data['name'] ?? '', $g, $g['members'][$i]['id']);
    } elseif ($op === 'member.remove') {
        $i = $find($g['members'], $data['id'] ?? null);
        if ($i === null) group_fail('Dit lid bestaat niet meer.');
        $m = $g['members'][$i];
        if ($m['id'] === ($g['ownerMember'] ?? null)) group_fail('Wie de groep maakte, kan niet verwijderd worden.');
        if (group_in_use($g, $m['id'])) group_fail($m['name'] . ' staat nog in uitgaven of terugbetalingen. Pas die eerst aan.');
        array_splice($g['members'], $i, 1);
    } elseif ($op === 'expense.save') {
        $raw = is_array($data['expense'] ?? null) ? $data['expense'] : [];
        $e = group_norm_expense($raw, $g);
        $i = is_string($raw['id'] ?? null) ? $find($g['expenses'], $raw['id']) : null;
        if ($i !== null) {
            $old = $g['expenses'][$i];
            if (isset($old['txId']) && !isset($e['txId']) && ($raw['unlinkTx'] ?? null) !== true) $e['txId'] = $old['txId'];
            $g['expenses'][$i] = array_merge(['id' => $old['id'], 'createdBy' => $old['createdBy'] ?? null, 'createdAt' => $old['createdAt'] ?? null], $e, ['updatedBy' => $by, 'updatedAt' => $now]);
            $result = $old['id'];
        } else {
            if (count($g['expenses']) >= GROUP_LIMITS['expenses']) group_fail('Deze groep heeft te veel uitgaven.');
            $id = $pick('e', $g['expenses']);
            $g['expenses'][] = array_merge(['id' => $id], $e, ['createdBy' => $by, 'createdAt' => $now, 'updatedAt' => $now]);
            $result = $id;
        }
    } elseif ($op === 'expense.delete') {
        $i = $find($g['expenses'], $data['id'] ?? null);
        if ($i === null) group_fail('Deze uitgave bestaat niet meer.');
        array_splice($g['expenses'], $i, 1);
    } elseif ($op === 'payment.save') {
        if (count($g['payments']) >= GROUP_LIMITS['payments']) group_fail('Deze groep heeft te veel terugbetalingen.');
        $id = $pick('p', $g['payments']);
        $g['payments'][] = array_merge(['id' => $id], group_norm_payment($data['payment'] ?? null, $g), ['createdBy' => $by, 'createdAt' => $now]);
        $result = $id;
    } elseif ($op === 'payment.delete') {
        $i = $find($g['payments'], $data['id'] ?? null);
        if ($i === null) group_fail('Deze terugbetaling bestaat niet meer.');
        array_splice($g['payments'], $i, 1);
    } elseif ($op === 'group.rename') {
        $n = group_clean($data['name'] ?? '', GROUP_LIMITS['groupName']);
        if ($n === '') group_fail('Geef de groep een naam.');
        $g['name'] = $n;
    } else group_fail('Onbekende wijziging.');
    $g['rev'] = ($g['rev'] ?? 0) + 1;
    $g['updatedAt'] = $now;
    return ['group' => $g, 'result' => $result];
}

function group_public(array $g): array { unset($g['owner']); return $g; }

function group_load($token): array {
    $g = is_string($token) && preg_match('/^[A-Za-z0-9_-]{32,64}$/', $token) ? read_json(group_file($token), null) : null;
    if (!is_array($g)) throw new HttpError(404, 'Deze groep bestaat niet (meer). Vraag een nieuwe link.');
    return $g;
}

function group_create(string $owner, array $b): array {
    $now = now_ms();
    $name = group_clean($b['name'] ?? '', GROUP_LIMITS['groupName']);
    if ($name === '') group_fail('Geef de groep een naam.');
    $g = ['id' => group_new_id('g'), 'name' => $name, 'members' => [], 'expenses' => [], 'payments' => [], 'rev' => 1, 'createdAt' => $now, 'updatedAt' => $now];
    $me = group_member_name($b['me'] ?? '', $g, null);
    $g['members'][] = ['id' => group_new_id('m'), 'name' => $me, 'createdAt' => $now];
    $g['ownerMember'] = $g['members'][0]['id'];
    foreach (array_slice(is_array($b['others'] ?? null) ? $b['others'] : [], 0, GROUP_LIMITS['members'] - 1) as $o) {
        if (group_clean($o, GROUP_LIMITS['name']) === '') continue;
        $g['members'][] = ['id' => group_new_id('m'), 'name' => group_member_name($o, $g, null), 'createdAt' => $now];
    }
    $g['owner'] = $owner;
    $token = b64url(random_bytes(24));
    write_json(group_file($token), $g);
    return ['token' => $token, 'group' => group_public($g)];
}

function group_remove(string $owner, array $b): array {
    $token = $b['token'] ?? null;
    return with_lock('group-' . substr(hash('sha256', (string) $token), 0, 32), function () use ($owner, $token) {
        $g = group_load($token);
        if (($g['owner'] ?? null) !== $owner) throw new HttpError(403, 'Enkel wie de groep maakte, kan ze verwijderen.');
        @unlink(data_dir() . '/' . group_file($token));
        return ['ok' => true];
    });
}

/** Nieuwe geheime link; de oude werkt daarna niet meer (enkel de eigenaar). */
function group_rotate(string $owner, array $b): array {
    $token = $b['token'] ?? null;
    return with_lock('group-' . substr(hash('sha256', (string) $token), 0, 32), function () use ($owner, $token) {
        $g = group_load($token);
        if (($g['owner'] ?? null) !== $owner) throw new HttpError(403, 'Enkel wie de groep maakte, kan de link vernieuwen.');
        $fresh = b64url(random_bytes(24));
        write_json(group_file($fresh), $g);
        @unlink(data_dir() . '/' . group_file($token));
        return ['token' => $fresh];
    });
}

/** Alle groepen van een account wissen (bij het verwijderen van dat account). */
function groups_remove_owned(string $owner): int {
    $n = 0;
    foreach (glob(data_dir() . '/group-*.json') ?: [] as $f) {
        if (!preg_match('/^group-[0-9a-f]{32}\.json$/', basename($f))) continue;
        $g = json_decode((string) @file_get_contents($f), true);
        if (is_array($g) && ($g['owner'] ?? null) === $owner) { @unlink($f); $n++; }
    }
    return $n;
}

function group_public_op(array $b): array {
    with_lock('group-writes', function () {
        $all = read_json('group-writes.json', []);
        $now = now_ms();
        foreach ($all as $ip => $list) {
            $all[$ip] = array_values(array_filter($list, fn($t) => $now - $t < 3600000));
            if (!$all[$ip]) unset($all[$ip]);
        }
        if (count($all[client_ip()] ?? []) >= GROUP_WRITE_LIMIT) throw new HttpError(429, 'Te veel wijzigingen na elkaar. Probeer binnen een uur opnieuw.');
        $all[client_ip()][] = $now;
        write_json('group-writes.json', $all);
    });
    $token = $b['t'] ?? null;
    return with_lock('group-' . substr(hash('sha256', (string) $token), 0, 32), function () use ($b, $token) {
        $g = group_load($token);
        $actor = isset($b['actor']) && $b['actor'] !== null ? (string) $b['actor'] : null;
        $r = group_apply_op($g, (string) ($b['op'] ?? ''), $b['data'] ?? null, $actor, now_ms());
        write_json(group_file($token), $r['group']);
        return ['group' => group_public($r['group']), 'result' => $r['result']];
    });
}
