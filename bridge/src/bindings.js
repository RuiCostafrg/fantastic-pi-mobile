import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
export const bindingError = message => Object.assign(new Error(message), { status: 409 });
const fail = () => { throw bindingError('Legacy workspace evidence conflicts or is incomplete. Restore the original workspace/configuration or resolve it explicitly before restarting.'); };
const entries = async path => readdir(path, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args], {
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, timeout: 10000
})).stdout.trim();

/** Read-only legacy inventory. Never repairs, creates, resets or deletes a tree. */
export async function legacyEvidence({ directory, project, spaces, jobs, reviews }) {
  const sessions = new Set();
  const records = new Map();
  const repoKey = hash(project.commonDirectory);
  const storage = resolve(directory, 'worktrees');
  for (const repo of await entries(storage)) {
    if (!repo.isDirectory() || !/^[a-f0-9]{24}$/.test(repo.name)) fail();
    for (const entry of await entries(join(storage, repo.name))) {
      if (entry.name.endsWith('.tmp')) continue; // interrupted atomic manifest write is not identity evidence
      if (entry.isDirectory()) {
        if (!(await entries(join(storage, repo.name))).some(e => e.name === entry.name + '.json')) fail();
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) fail();
      const record = JSON.parse(await readFile(join(storage, repo.name, entry.name), 'utf8'));
      const session = record.sessionId;
      if (typeof session !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(session)) fail();
      const key = hash(session);
      const path = join(storage, repoKey, key);
      if (repo.name !== repoKey || entry.name !== key + '.json' || record.version !== 1 ||
          record.repository !== project.commonDirectory || record.path !== path ||
          record.branch !== 'pocket/' + repoKey + '/' + key || typeof record.baseBranch !== 'string' ||
          !/^[a-f0-9]{40,64}$/.test(record.baseCommit) || !['preparing', 'ready'].includes(record.state)) fail();
      try {
        await git(project.source, 'check-ref-format', 'refs/heads/' + record.baseBranch);
        await git(project.source, 'cat-file', '-e', record.baseCommit + '^{commit}');
        if (record.state === 'ready') {
          records.set(session, await spaces.existing(session));
        } else {
          const exists = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (exists) {
            if (!exists.isDirectory() || await realpath(path) !== path ||
                await realpath(await git(path, 'rev-parse', '--show-toplevel')) !== path ||
                await realpath(await git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir')) !== project.commonDirectory ||
                await git(path, 'symbolic-ref', 'HEAD') !== 'refs/heads/' + record.branch) fail();
          } else {
            const branch = await git(project.source, 'for-each-ref', '--format=%(objectname)', 'refs/heads/' + record.branch);
            if (branch && branch !== record.baseCommit) fail();
          }
          records.set(session, { ...record, repositoryRoot: project.repositoryRoot,
            cwd: join(path, project.subdirectory) });
        }
      } catch { fail(); }
      sessions.add(session);
    }
  }
  for (const job of jobs) {
    const session = job.sessionId ?? 'pocket';
    sessions.add(session);
    if (job.workspace) {
      const record = records.get(session);
      if (!record) fail();
      for (const key of ['cwd', 'path', 'branch', 'baseBranch', 'baseCommit', 'repositoryRoot']) {
        // Early worktree job snapshots omitted this redundant field. The manifest
        // and real Git tree above already prove the root; never repair the record,
        // accept an explicit conflict, or waive any core identity/base field.
        if (key === 'repositoryRoot' && !Object.hasOwn(job.workspace, key)) continue;
        if (job.workspace[key] !== record[key]) fail();
      }
    }
  }
  for (const review of reviews) sessions.add(review.sessionId);
  return sessions;
}

/** Within the acceptance transaction; callers must not persist a binding on refusal. */
export function bindSession(document, projects, sessionId, requested, expected) {
  if (requested !== undefined && (typeof requested !== 'string' || !requested)) {
    throw Object.assign(new Error('Invalid projectId'), { status: 400 });
  }
  const established = Object.hasOwn(document.items, sessionId) ? document.items[sessionId].projectId : undefined;
  if ((requested !== undefined && established && requested !== established) ||
      (expected && ((requested !== undefined && requested !== expected) || established !== expected))) {
    throw bindingError('Project/chat/request binding conflict. Create a new chat instead.');
  }
  const projectId = requested ?? established ?? document.defaultProjectId;
  if (!Object.hasOwn(projects.items, projectId)) throw Object.assign(new Error('Unknown project.'), { status: 404 });
  document.items[sessionId] = { projectId };
  return projectId;
}
