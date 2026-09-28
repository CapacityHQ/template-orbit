import { CreateWorkspaceForm } from '@/features/workspaces/create-workspace-form.tsx';
import { canCreateWorkspace } from '@/lib/auth/first-account.ts';
import { requireSession } from '@/lib/auth/session.ts';

export default async function NewWorkspacePage() {
  const session = await requireSession();
  const allowed = await canCreateWorkspace(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">
          {allowed ? 'Create a workspace' : 'Your workspace'}
        </h1>
        <p className="text-muted text-xs">
          {allowed
            ? 'A workspace gets its own teams, issues, and members. You start as its admin with a default team, its workflow states, and a starter label set.'
            : "You're not in a workspace yet. Ask an admin to invite you."}
        </p>
      </header>
      {allowed ? <CreateWorkspaceForm /> : null}
    </div>
  );
}
