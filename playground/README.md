# playground

## Purpose

This package is the Reflex application behind the contract playground: the
in-browser editor UI, per-session sandboxes, and the services that run the
`xian_vm_v1` execution path.

## Contents

- `playground.py` — Reflex app assembly and page definition.
- `state.py` — the Reflex state backing the editor, deploy, and call flows.
- `components/monaco_editor.py` — the Monaco editor integration.
- `services/` — the session and runtime layer:
  - `sessions.py` — per-session sandbox lifecycle and filesystem-backed
    state under `.sessions/`.
  - `contracting.py`, `runtime.py`, `worker.py` — source compilation and
    native Xian VM execution of deploy and call requests.
  - `linting.py` — `xian-linter` integration.
  - `environment.py` — sandbox environment shaping.
- `defaults.py`, `middleware.py` — starter contract content and request
  middleware.

## Notes

- `.sessions/` is runtime state, not source; it is safe to delete locally and
  must never be committed.
- Sessions execute user-supplied contract source through the VM-core package;
  changes to the sandbox, worker isolation, or VM context in `services/` are
  security-sensitive.

## Next

- Follow a deploy from `state.py` into `services/sessions.py` and
  `services/runtime.py`.
