# Changelog

All notable changes to `hedge-broker` are documented here. This project follows
[Semantic Versioning](https://semver.org) and
[Keep a Changelog](https://keepachangelog.com).

## [0.1.0] - 2026-07-06

### Added

- Initial release.
- OAuth 2.1 sign-in: device-code (default, works over SSH), browser loopback (`--browser`), with automatic token refresh and `0600` credential storage.
- `login`, `logout`, `whoami`.
- Submissions: `submit`, `upload`, `requirements`, `finalize`, `status`, `submissions`.
- Instant carrier quotes: `quotes`, `answer`, `request-quote`.
- `appetite`, `policies`, `payments`.
- Global `--json` output and `--staging` environment switch.
- Distributed three ways: npm (`hedge-broker`), Homebrew (`taventech/tap/hedge`), and a self-contained binary via the curl installer.
