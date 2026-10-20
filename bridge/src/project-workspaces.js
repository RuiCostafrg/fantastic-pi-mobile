import { openWorkspaces } from './workspaces.js';

/** Shared by coding and review. Reads never bind a session or create a checkout. */
export function projectWorkspaces({ directory, resolveProject, defaultProjectId, defaultWorkspaces }) {
  const managers = new Map();
  if (defaultWorkspaces) managers.set(defaultProjectId, Promise.resolve(defaultWorkspaces));
  async function manager(sessionId) {
    // Revalidate even cached managers: a deleted/replaced source must fail closed.
    const project = await resolveProject(sessionId);
    if (!managers.has(project.projectId)) {
      const policy = project.branchPolicy;
      const pending = openWorkspaces({ directory, cwd: project.source,
        ...(policy.kind === 'local' ? { defaultBranch: policy.branch } : { remote: policy.remote }) });
      managers.set(project.projectId, pending);
      pending.catch(() => { if (managers.get(project.projectId) === pending) managers.delete(project.projectId); });
    }
    return managers.get(project.projectId);
  }
  return {
    async forSession(sessionId, signal) { return (await manager(sessionId)).forSession(sessionId, signal); },
    async existing(sessionId, signal) { return (await manager(sessionId)).existing(sessionId, signal); }
  };
}
