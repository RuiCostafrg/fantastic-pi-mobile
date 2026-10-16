import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, realpath, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { log } from './log.js';

const exec = promisify(execFile);
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const inside = (root, path) => { const part = relative(root, path); return part === '' || (!part.startsWith('..') && !isAbsolute(part)); };
async function git(cwd, args, signal) {
  try {
    const { stdout } = await exec('git', ['-C', cwd, ...args], {
      signal, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return stdout.trim();
  } catch (error) {
    if (signal?.aborted) throw new Error('Workspace preparation cancelled');
    // Git stderr can contain credential-bearing remote URLs and private paths.
    throw new Error('Git workspace operation failed (' + args[0] + '). Check repository/default-branch configuration and network access.');
  }
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function save(path, record) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, path);
}

/** One stable worktree per repository/chat. Never falls back to the shared checkout. */
export async function openWorkspaces({ cwd, directory, defaultBranch, remote = 'origin' }) {
  const source = await realpath(cwd);
  const root = await realpath(await git(source, ['rev-parse', '--show-toplevel']));
  const common = await realpath(await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const subdirectory = relative(root, source);
  if (!inside(root, source)) throw new Error('Workspace must be inside the configured repository');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(remote)) throw new Error('Use a named Git remote');
  if (defaultBranch) await git(root, ['check-ref-format', 'refs/heads/' + defaultBranch]);
  const repoId = hash(common);
  const storage = resolve(directory, 'worktrees', repoId);
  await mkdir(storage, { recursive: true, mode: 0o700 });
  const storageRoot = await realpath(storage);
  let tail = Promise.resolve();
  async function prepare(sessionId, signal) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(sessionId)) throw new Error('Invalid workspace session');
    signal?.throwIfAborted();
    const sessionKey = hash(sessionId);
    const path = join(storageRoot, sessionKey);
    const recordPath = path + '.json';
    const branch = 'pocket/' + repoId + '/' + sessionKey;
    let record;
    const reused = await exists(recordPath);
    if (reused) {
      record = JSON.parse(await readFile(recordPath, 'utf8'));
      if (record.version !== 1 || record.repository !== common || record.sessionId !== sessionId || record.path !== path || record.branch !== branch || !/^[0-9a-f]{40,64}$/.test(record.baseCommit) || typeof record.baseBranch !== 'string' || !['preparing', 'ready'].includes(record.state)) throw new Error('Workspace record does not match this repository/chat; refusing to reuse it');
    } else {
      if (await exists(path)) throw new Error('Unregistered workspace directory exists; refusing to overwrite it');
      let baseRef, baseBranch;
      if (defaultBranch) {
        // Explicit local default branch supports offline/local-only repositories.
        baseBranch = defaultBranch;
        baseRef = 'refs/heads/' + defaultBranch;
      } else {
        const head = await git(root, ['ls-remote', '--symref', '--', remote, 'HEAD'], signal);
        const match = head.match(/^ref: refs\/heads\/(.+)\tHEAD$/m);
        if (!match) throw new Error('Cannot determine remote default branch. Set PI_DEFAULT_BRANCH for an explicit local branch.');
        baseBranch = match[1];
        await git(root, ['check-ref-format', 'refs/heads/' + baseBranch], signal);
        baseRef = 'refs/remotes/' + remote + '/' + baseBranch;
        await git(root, ['fetch', '--no-tags', '--', remote, '+refs/heads/' + baseBranch + ':' + baseRef], signal);
      }
      const baseCommit = await git(root, ['rev-parse', '--verify', baseRef + '^{commit}'], signal);
      // Reserve identity/base before Git mutates anything. A restart can recover preparation,
      // but never reset a ready worktree or discard its uncommitted changes.
      record = { version: 1, repository: common, sessionId, path, branch, baseBranch, baseCommit, state: 'preparing' };
      await save(recordPath, record);
    }
    if (!await exists(path)) {
      if (record.state === 'ready') throw new Error('Chat worktree is missing. Restore it manually; refusing to recreate or lose work.');
      const branches = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/' + branch], signal);
      if (branches) {
        const commit = await git(root, ['rev-parse', '--verify', 'refs/heads/' + branch + '^{commit}'], signal);
        if (branches !== 'refs/heads/' + branch || commit !== record.baseCommit) throw new Error('Reserved worktree branch changed; refusing to reset it');
        await git(root, ['worktree', 'add', path, branch], signal);
      } else await git(root, ['worktree', 'add', '-b', branch, path, record.baseCommit], signal);
    }
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Worktree path must not be a symbolic link');
    const actualRoot = await realpath(await git(path, ['rev-parse', '--show-toplevel'], signal));
    const actualCommon = await realpath(await git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal));
    const actualBranch = await git(path, ['symbolic-ref', '--quiet', 'HEAD'], signal);
    if (actualRoot !== path || actualCommon !== common || actualBranch !== 'refs/heads/' + branch) throw new Error('Worktree repository/branch changed; refusing to run in the wrong checkout');
    const workingDirectory = await realpath(join(path, subdirectory));
    if (!inside(path, workingDirectory)) throw new Error('Project subdirectory escapes its worktree');
    if (record.state !== 'ready') { record.state = 'ready'; await save(recordPath, record); }
    log('workspace.ready', { sessionId, status: reused ? 'reused' : 'created' });
    return { cwd: workingDirectory, path, branch, baseBranch: record.baseBranch, baseCommit: record.baseCommit };
  }
  return {
    forSession(sessionId, signal) {
      // Serialize only Git preparation. Model/tool execution remains concurrent.
      const next = tail.then(() => prepare(sessionId, signal));
      tail = next.catch(error => { log('workspace.failed', { sessionId, errorType: error.constructor?.name ?? 'Error' }); });
      return next;
    }
  };
}
