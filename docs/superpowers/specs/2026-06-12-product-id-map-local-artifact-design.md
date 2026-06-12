# Product ID Map Local Artifact Design

## Goal

Treat `config/product-id-map.json` and `config/product-id-map.backup.json` as local runtime artifacts instead of shared repository data.

## Current Behavior

- `config/product-id-map.json` is the default platform product ID to internal product ID mapping path.
- Public traffic reports refresh this file from the exported goods workbook during each run.
- Exposure crawling reads this file as a fallback validator to avoid accepting malformed product IDs parsed from table text.
- `config/product-id-map.backup.json` is automatically copied from the previous mapping before refresh.

## Design

- Stop tracking `config/product-id-map.json` and `config/product-id-map.backup.json` in Git.
- Keep the files on the local machine so current report runs are not disrupted.
- Add both runtime files to `.gitignore`.
- Keep `config/product-id-map.example.json` tracked as the repository template.
- Do not change runtime code paths. Existing report behavior remains: default path is still `config/product-id-map.json`, and report runs can regenerate it.

## Error Handling

- No new runtime error handling is required.
- Existing missing-file handling remains valid: report and exposure flows log mapping absence and continue where supported.

## Testing

- Verify Git no longer reports the runtime files as tracked or modified.
- Verify `.gitignore` contains both runtime paths.
- Run targeted tests covering mapping/report source behavior.
- Run the TypeScript build.

## Out Of Scope

- Changing the mapping file format.
- Moving the default mapping path.
- Committing the current live mapping data.
- Removing unrelated Feishu bot planning files.
