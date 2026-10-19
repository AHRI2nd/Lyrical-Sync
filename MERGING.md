# Merging common updates into the Store edition

`dev-next` owns common feature development. `store-lite` consumes reviewed merges and retains its platform and product adapters. Merge **toward Store**; do not merge Store packaging, privacy defaults or feature removals back into the direct edition wholesale.

## Boundaries

Shared view modules include lyric rows, line navigation, bulk actions, transport controls, settings tabs, and their common CSS. Editing state, pointer ownership, file access and service selection stay in the edition parent. Store uses the non-memoized row view so callbacks keep the same freshness as its former inline renderer; the direct edition keeps its memoized view.

Store intentionally excludes Spotify/device/YouTube/LRCLIB integrations, Python/model/code download or execution, and the direct updater. It retains offline editing, AutoSpot, OS language, local privacy controls, App Sandbox bookmarks, MSIX runtime behavior and license notices. These are project boundaries; they are not claims that every excluded feature is universally prohibited by every store.

App Store checks preserve the existing self-contained bundle, sandbox/user-selected-file and app-scoped-bookmark entitlements, and Store update channel. Microsoft Store checks preserve this project's MSIX identity, declared capabilities, DPI/SmartScreen/runtime security and packaging path. External MSI/EXE policy is not interchangeable with this MSIX channel. Current official references: [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/) and [Microsoft Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies). Local checks do not guarantee certification or signing acceptance.

## Normal reviewed merge

1. Start with a clean `store-lite` checkout and up-to-date remote refs. Inspect the incoming commits and `git diff store-lite...dev-next`.
2. Run `git merge --no-commit --no-ff dev-next`. Resolve edition adapters intentionally. Existing common files should usually merge directly; newly introduced files and changed dependencies/platform settings require review. Never use blanket `ours`/`theirs` or an ancestry-only merge to hide unported functionality.
3. Compare the resolved tree with both parents. `config/edition-integration.json` records the reconciliation baseline and intentional differences; it is a review map, not a custom Git merge driver.
4. Run `npm ci` after switching editions, then:

   ```sh
   node --test scripts/store-boundaries.node-test.mjs
   node scripts/check-store-boundaries.mjs
   npm test
   npm run build
   npm run test:dependencies
   npm run test:packaging
   npm run licenses:check
   cargo test --locked --manifest-path src-tauri/Cargo.toml
   ```

5. Validate unsigned App Store and MS Store builds on their target platforms, including file-open/bookmark recovery, privacy/reset, audio and editing flows. Use the existing platform scripts and CI. Commit the actual resolved merge only after the checks pass. Push only with user authorization.

## Reviewing a boundary change

`config/store-boundaries.json` inventories reviewed Store source files, permitted dependency names/native commands, excluded direct-edition paths and SHA-256 hashes of sensitive platform files. A new common file, deletion, dependency, command or platform change deliberately fails closed until reviewed. Inspect the implementation first; update the inventory or hashes only when the new Store behavior is intended and platform constraints remain valid. Do not add forbidden integration imports merely to make compilation succeed.

The guard detects common accidental reintroductions; it is not a general static security proof. CSP, sandbox permissions, tests, native builds and human review remain necessary. Protected file hashes make platform changes explicit, including version/identity updates that also require packaging and notice review.

CI runs on Store pull requests as well as pushes and manual dispatches. It combines boundary checks with the existing frontend, license, runtime security, MSIX/App Store packaging and native build gates. A clean Git merge alone is never the acceptance criterion.
