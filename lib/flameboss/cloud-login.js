/**
 * Exchanges a myflameboss.com login for MQTT credentials.
 *
 * POST https://myflameboss.com/api/v4/sessions with session[login] and
 * session[password] returns { user_id, username, auth_token }. The MQTT
 * username is "T-<user_id>" and the password is auth_token. The account
 * password is never stored – only the token.
 */

async function cloudLogin({ login, password, host = 'myflameboss.com', fetchImpl = fetch }) {
    if (!login || !password) throw new Error('Email and password are required');
    const body = new URLSearchParams({ 'session[login]': login, 'session[password]': password });
    let res;
    try {
        res = await fetchImpl(`https://${host}/api/v4/sessions`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: AbortSignal.timeout(15000),
        });
    } catch (err) {
        throw new Error(`Could not reach ${host}: ${err.message}`);
    }
    if (res.status === 401 || res.status === 403 || res.status === 422) throw new Error('Flame Boss rejected that email/password');
    if (!res.ok) throw new Error(`Flame Boss login failed (HTTP ${res.status})`);
    const data = await res.json().catch(() => ({}));
    if (!data.user_id || !data.auth_token) throw new Error('Unexpected login response from Flame Boss');
    return { userId: data.user_id, username: data.username || null, token: data.auth_token };
}

module.exports = { cloudLogin };
