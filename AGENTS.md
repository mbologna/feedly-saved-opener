# AGENTS.md

Notes for coding agents working in this repository. [README.md](README.md) covers what it does and how to use it; [CLAUDE.md](CLAUDE.md) covers the commands, architecture and conventions.

## Versioning

Plain SemVer: `vX.Y.Z` tags, each building the extension at that version and publishing a GitHub Release with the Firefox and Edge/Chrome ZIPs and a Firefox Add-ons submission, per the [versioning standard](https://github.com/mbologna/.github/blob/main/VERSIONING.md).

- Never create, move or delete tags, and never edit a version number to cut a release: auto-release tags from the commit types (`feat` minor; `fix`, `perf`, `revert` patch; `!` or a `BREAKING CHANGE:` footer major).
- Write Conventional Commit subjects; they decide the next version.
- Don't edit `version` in `manifest.json` or `package.json`: the `publish` job writes the tag's version into `manifest.json` before it builds, and the committed values lag behind the tags.
