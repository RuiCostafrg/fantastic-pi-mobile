import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, access, constants } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const exec = promisify(execFile);
const commands = ['status', 'start', 'pause', 'resume', 'stop'];
// These are public controller codes, not arbitrary launcher strings.
const statusReasons = new Set(['storage-lock-missing', 'owner-unreadable', 'owner-pid-invalid',
  'owner-process-missing', 'owner-identity-mismatch', 'storage-unreadable', 'health-unavailable',
  'health-authentication-failed', 'health-unverified', 'health-owner-unverified',
  'http-owner-mismatch', 'maintenance-unavailable', 'maintenance-unverified', 'owner-changed']);
const tools = commands.map(command => ({
  name: 'fantastic-pi-mobile.' + command,
  description: command === 'status' ? 'Read host-local Fantastic Pi Mobile bridge metadata; no device actions.' :
    `Explicit host-local Fantastic Pi Mobile ${command}; guarded launcher remains authoritative. No automatic retry.`,
  requiresApproval: command !== 'status',
  parameters: { type: 'object', properties: command === 'status' ? {} : { confirmed: { type: 'boolean', const: true } },
    required: command === 'status' ? [] : ['confirmed'], additionalProperties: false },
}));
export const piDroidManifest = {
  schemaVersion: '1.0', name: 'fantastic-pi-mobile', displayName: 'Fantastic Pi Mobile host bridge',
  description: 'Optional explicit host-local bridge management; not device automation.',
  requiredCoreVersion: '>=0.2.0', targetApps: ['dev.fantasticpimobile'], tools,
};

class FantasticPiMobilePlugin {
  name = 'fantastic-pi-mobile';
  displayName = piDroidManifest.displayName;
  targetApps = ['dev.fantasticpimobile'];
  launcher = null;
  busy = false;
  destroyed = false;
  async initialize(config) {
    // No .env read, process launch, tmux mutation or device selection during loading.
    if (typeof config.checkout !== 'string' || !isAbsolute(config.checkout)) throw new Error('Absolute host-local Fantastic Pi Mobile checkout required.');
    const root = await realpath(config.checkout);
    this.launcher = join(root, 'scripts/bridge-work');
    await access(this.launcher, constants.X_OK);
    this.session = config.session ?? 'work';
    this.window = config.window ?? 'fantastic-pi-mobile-bridge';
    if (![this.session, this.window].every(n => typeof n === 'string' && /^[a-zA-Z0-9_-]+$/.test(n)))
      throw new Error('Invalid dedicated tmux session/window name.');
    this.destroyed = false;
  }
  getCapabilities() { return structuredClone(tools); }
  async getStatus() {
    const result = await this.execute('fantastic-pi-mobile.status', {});
    const ready = result.success && result.data.ready === true;
    return { ready, message: ready ? 'Host bridge identity verified.' : 'Host bridge unavailable or unverified; previously dispatched work may still be running.',
      ...(result.success ? { metadata: result.data } : {}) };
  }
  async execute(action, params) {
    const command = commands.find(c => action === 'fantastic-pi-mobile.' + c);
    const refusal = code => ({ success: false, data: { code }, error: 'No automatic retry; inspect host-local state. Admissions may remain paused.' });
    if (!command || !params || typeof params !== 'object' || Array.isArray(params) ||
        Object.keys(params).some(k => command === 'status' || k !== 'confirmed')) return refusal('invalid-action-or-parameters');
    if (command !== 'status' && params.confirmed !== true) return refusal('explicit-consent-required');
    if (!this.launcher || this.destroyed) return refusal('not-initialized');
    if (this.busy) return refusal('controller-busy');
    this.busy = true;
    try {
      // .env is loaded only by the trusted launcher. Never forward host PI/PORT overrides.
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PI_') && !k.startsWith('FANTASTIC_PI_MOBILE_') && k !== 'PORT' && k !== 'NODE_OPTIONS'));
      env.FANTASTIC_PI_MOBILE_TMUX_SESSION = this.session;
      env.FANTASTIC_PI_MOBILE_TMUX_WINDOW = this.window;
      const { stdout } = await exec(this.launcher, [command], { env, timeout: 120_000, maxBuffer: 1024 * 1024 });
      if (command !== 'status') return { success: true, data: { command, verification: 'launcher-completed' } };
      const state = JSON.parse(stdout);
      // Inspection succeeded, but this does not establish readiness or idleness.
      // Do not forward partial owner/storage evidence from an unverified result.
      if (state.ready === false && ['unavailable', 'unverified'].includes(state.state))
        return { success: true, data: { ready: false, state: state.state,
          reason: statusReasons.has(state.reason) ? state.reason : 'identity-unverified' } };
      // Whitelist metadata; never echo launcher output, health/config, tokens or OS errors.
      // Keep compatibility with the original identity-checked launcher schema.
      if ((state.ready !== undefined || state.state !== undefined) && (state.ready !== true || state.state !== 'verified'))
        return refusal('identity-unverified');
      if (!Number.isSafeInteger(state.owner?.pid) || state.health?.processId !== state.owner.pid ||
          typeof state.storage?.idle !== 'boolean') return refusal('identity-unverified');
      return { success: true, data: {
        ready: true, state: 'verified',
        owner: { pid: state.owner.pid, startTicks: state.owner.startTicks },
        storage: { idle: state.storage.idle, activeTasks: state.storage.activeTasks, totalTasks: state.storage.totalTasks },
        maintenance: state.maintenance == null ? null : {
          admissionsPaused: state.maintenance.admissionsPaused, idle: state.maintenance.idle,
        },
      } };
    } catch { return refusal('controller-refused-or-outcome-unknown'); }
    finally { this.busy = false; }
  }
  async onHeartbeat() { return null; }
  async destroy() { this.destroyed = true; /* Never stop production on plugin unload. */ }
}
export function createPlugin() { return new FantasticPiMobilePlugin(); }
