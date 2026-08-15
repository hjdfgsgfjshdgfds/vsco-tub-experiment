# Development workflow

`main` is the releasable, known-good extension. Do not develop directly on it.

For each change:

1. Create a short-lived branch from `main`, such as `fix/search-submit` or `experiment/profile-layout`.
2. Use a separate worktree when the experiment needs to remain installed beside the stable extension.
3. Give simultaneously installed worktrees distinct manifest identities so their Chrome storage and service workers remain isolated.
4. Make focused commits with messages that describe the behavior changed.
5. Run JavaScript syntax checks and test the actual unpacked extension in Chrome.
6. Merge or squash into `main` only after the branch passes live QA.
7. Delete completed feature branches; tag important working baselines.

If an experiment fails, preserve it only when it contains useful evidence. Otherwise delete its branch after confirming that `main` remains unaffected.

The previous pre-recovery line is preserved at `archive/master-before-recovery-2026-08-10`.
