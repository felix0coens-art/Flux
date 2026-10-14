<?php
/*
 * Gedeelde boekhouding (huishouden). Zelfde gedrag als server/household.js.
 *
 * De eigenaar van het huishouden maakt een eenmalige uitnodigingscode. Wie die code invult, werkt
 * daarna in de boekhouding van de eigenaar (transacties, categorieën, bonnetjes, ...). Zijn eigen
 * gegevens blijven bewaard en komen terug als hij het huishouden verlaat. Bankkoppelingen en eigen
 * sleutels blijven per persoon.
 */

declare(strict_types=1);

const INVITE_DAYS = 7;

/** Wiens boekhouding gebruikt deze gebruiker? (zichzelf, of de eigenaar van zijn huishouden) */
function data_user(string $user, ?array $me = null): string {
    $users = get_users();
    $me = $me ?? ($users[$user] ?? null);
    $owner = is_array($me) ? (string) ($me['shareOf'] ?? '') : '';
    if ($owner === '' || $owner === $user) return $user;
    $o = $users[$owner] ?? null;
    if (!is_array($o) || !empty($o['disabled']) || !in_array($user, $o['household'] ?? [], true)) return $user;
    return $owner;
}

function display_name_of(array $users, string $name): string {
    $u = $users[$name] ?? [];
    return (string) ($u['displayName'] ?? ($u['google']['name'] ?? $name));
}

function household_status(string $user): array {
    $users = get_users();
    $me = $users[$user] ?? [];
    $owner = data_user($user, $me);
    if ($owner !== $user) {
        return ['role' => 'member', 'owner' => ['user' => $owner, 'name' => display_name_of($users, $owner)],
            'members' => array_map(fn($m) => ['user' => $m, 'name' => display_name_of($users, $m)], array_values(array_filter($users[$owner]['household'] ?? [], fn($m) => isset($users[$m]))))];
    }
    $members = array_values(array_filter($me['household'] ?? [], fn($m) => isset($users[$m]) && (($users[$m]['shareOf'] ?? '') === $user)));
    return ['role' => $members ? 'owner' : 'none', 'members' => array_map(fn($m) => ['user' => $m, 'name' => display_name_of($users, $m)], $members)];
}

function household_invite(string $user): array {
    if (data_user($user) !== $user) throw new HttpError(400, 'Je zit zelf in het huishouden van iemand anders. Verlaat dat eerst.');
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $code = '';
    for ($i = 0; $i < 8; $i++) $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    with_lock('household-invites', function () use ($code, $user) {
        $p = read_json('household-invites.json', []);
        foreach ($p as $k => $v) if (time() - ($v['at'] ?? 0) > INVITE_DAYS * 86400 || ($v['owner'] ?? '') === $user) unset($p[$k]);
        $p[hash('sha256', $code)] = ['owner' => $user, 'at' => time()];
        write_json('household-invites.json', $p);
    });
    return ['code' => substr($code, 0, 4) . '-' . substr($code, 4), 'validDays' => INVITE_DAYS];
}

function household_join(string $user, array $b): array {
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) ($b['code'] ?? '')));
    $hit = with_lock('household-invites', function () use ($code) {
        $p = read_json('household-invites.json', []);
        $k = hash('sha256', $code);
        $h = $p[$k] ?? null;
        if ($h) { unset($p[$k]); write_json('household-invites.json', $p); }
        return $h && time() - ($h['at'] ?? 0) <= INVITE_DAYS * 86400 ? $h : null;
    });
    if ($code === '' || !$hit) throw new HttpError(400, 'Deze code klopt niet of is verlopen. Vraag een nieuwe.');
    $owner = (string) $hit['owner'];
    if ($owner === $user) throw new HttpError(400, 'Dit is je eigen uitnodiging.');
    with_lock('users', function () use ($user, $owner) {
        $users = get_users();
        if (!isset($users[$owner]) || !empty($users[$owner]['disabled'])) throw new HttpError(400, 'Dit huishouden bestaat niet meer.');
        if (!empty($users[$user]['household'])) throw new HttpError(400, 'Er werken al anderen in jouw boekhouding. Haal hen eerst uit je huishouden.');
        if (($users[$owner]['role'] ?? '') === 'admin' || ($users[$user]['role'] ?? '') === 'admin') throw new HttpError(400, 'Niet mogelijk voor het beheerdersaccount.');
        $users[$user]['shareOf'] = $owner;
        $list = $users[$owner]['household'] ?? [];
        if (!in_array($user, $list, true)) $list[] = $user;
        $users[$owner]['household'] = $list;
        write_json('users.json', $users);
    });
    return household_status($user);
}

/** Verlaten (lid) of iemand eruit halen (eigenaar). */
function household_leave(string $user, array $b): array {
    $target = (string) ($b['user'] ?? $user);
    with_lock('users', function () use ($user, $target) {
        $users = get_users();
        if ($target === $user) {
            $owner = (string) ($users[$user]['shareOf'] ?? '');
            unset($users[$user]['shareOf']);
            if ($owner !== '' && isset($users[$owner])) $users[$owner]['household'] = array_values(array_filter($users[$owner]['household'] ?? [], fn($m) => $m !== $user));
        } else {
            if (!in_array($target, $users[$user]['household'] ?? [], true)) throw new HttpError(404, 'Niet in jouw huishouden');
            $users[$user]['household'] = array_values(array_filter($users[$user]['household'], fn($m) => $m !== $target));
            if (($users[$target]['shareOf'] ?? '') === $user) unset($users[$target]['shareOf']);
        }
        foreach (['household'] as $k) if (isset($users[$user][$k]) && !$users[$user][$k]) unset($users[$user][$k]);
        write_json('users.json', $users);
    });
    return household_status($user);
}
