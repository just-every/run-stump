// What `rer export` writes and `rer import` restores (STUMP-DATA-001): every
// record the company keeps in Stump, in one versioned archive, and no token or
// key. Credentials, sealed secrets and consents in progress stay in the
// installation. The archive holds each record as a restore leaves it, so
// exporting the restored installation gives the same records:
//   - connected accounts wait for their owners to reconnect (no credentials):
//     state expired, the accounts module's state for an account that needs reconnecting;
//   - scheduled items are paused until a person schedules them again;
//   - Orbit and Vane connections and alert destinations wait to be entered again;
//   - the AI provider keeps its address and model, and its key waits to be entered again;
//   - agent credentials are revoked, and a person issues new ones.
// Pure, synchronous and idempotent: the transfer runs it on every row.
const reconnectPath = id => `/app/settings/accounts?reconnect=${encodeURIComponent(id)}`
const RESTORED = 'Restored from an archive. Reconnect its account, then schedule it again.'

const rows = {
  stump_accounts(row) {
    if (row.state === 'disconnected') return row
    return { ...row, state: 'expired', reconnect_url: reconnectPath(row.id), token_expires_at: null }
  },
  stump_items(row) {
    if (row.state !== 'scheduled') return row
    return { ...row, state: 'paused', hold: JSON.stringify({ owner_id: row.person_id, reason: RESTORED, next_attempt_at: null, kind: 'restore' }) }
  },
  stump_stack_connections(row) {
    return { ...row, secret_sealed: '', state: 'disconnected', disconnected_at: row.disconnected_at ?? row.connected_at }
  },
  stump_watches(row) {
    if (row.alerts === null) return row
    const alerts = JSON.parse(row.alerts)
    if (alerts.slack === null && alerts.webhook === null) return row
    return { ...row, alerts: JSON.stringify({ ...alerts, slack: null, webhook: null }) }
  },
  stump_ai_provider(row) {
    return { ...row, api_key: null }
  },
  stump_agent_credentials(row) {
    return { ...row, token_hash: `revoked:${row.client_id}`, revoked_at: row.revoked_at ?? row.created_at }
  },
}

export default {
  product: 'runeditrun/foundation',
  includeTables: ['oa_operators', 'oa_bootstrap', 'oa_external_identities', 'oa_invitation_cancellations', 'oa_tokens', 'oa_auth_settings', 'oa_auth_audit', 'oa_domain_rules', 'oa_logout_events', 'oc_owner_claims', 'oc_idp_grants'],
  // Consents in progress and each Mastodon instance's app registration are sealed to this installation.
  excludeTables: ['rer_dependency_keys', 'rer_dependency_pending', 'rer_dependency_codes', 'stump_connections', 'stump_mastodon_apps'],
  secretColumns: { stump_accounts: ['credentials'], stump_network_apps: ['client_id', 'client_secret'] },
  exportRow: (table, row) => Object.hasOwn(rows, table) ? rows[table](row) : row,
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
}
