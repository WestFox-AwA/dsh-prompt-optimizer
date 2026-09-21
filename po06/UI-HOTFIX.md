# 0.6.0-beta.10 UI hotfix

- Installed into the web profile using the normal DSH plugin installer; all 31 lib files match the source.
- Hot reload refreshes this package's client metadata and bundle without restarting DSH.
- Model dropdown loads the host model catalogue; saved selection overrides the interpreter route.
- Prompt editor receives the current text; save, restore built-in, and undo the most recent modification are available.
- Undo covers prompt edits made by this version; item/packet history rollback is not implemented.

Validation: syntax checks of four changed JS files; a temporary-directory save/undo check; one check against the existing 127.0.0.1:3080 instance returned beta.10, 35 models without catalogue errors, 1708 prompt characters, and HTTP 200 for the registered client bundle. No new browser instance or paid model-generation test was run. Full release/mutation gate was stopped at the user's request.

User acceptance: refresh the current tab, open the 0.6 indicator, select a model, and verify the prompt editor shows its text. DSH restart is not required.

Artifact: ~/.dsh/po06-beta/dsh-external-dsh-po06-0.6.0-beta.10.tgz. GitHub release is not published by this hotfix.
