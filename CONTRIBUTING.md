# Contributing

Thank you for your interest in contributing to cli-agent-resume.

## License

By contributing you agree that your changes will be licensed under the
[GNU General Public License v3.0](LICENSE), the same license that covers this project.

## Getting started

1. Fork the repository and clone your fork.
2. Follow the setup instructions in [README.md](README.md).
3. Create a feature branch: `git checkout -b my-feature`.
4. Make your changes and run the test suites (see README for commands).
5. Push your branch and open a pull request against `master`.

## Code style

- **Backend (Python)**: follow PEP 8; keep functions focused and testable.
- **Frontend (TypeScript)**: no framework; keep cross-panel communication on the `EventBus`.
- **Tests**: add or update tests for any behavior you change. The backend test suite lives in
  `backend/tests/`; frontend tests are plain `.mjs` files in `src/tests/`.

## Replacing the portfolio content

The files under `www/` are illustrative placeholder content for the original author. If you
are forking this project, replace all Markdown files in `www/` with your own content before
deploying. No code changes are required — the manifest loader picks up the directory
structure automatically at build time.

## Reporting issues

Open a GitHub issue with:
- A clear title describing the problem.
- Steps to reproduce.
- The Node.js, Python, and OS versions you are using.
- Any relevant logs or error output.

## Scope

This project is intentionally small — a single-VPS, single-process portfolio. Pull requests
that add external service dependencies, databases, or auth layers are unlikely to be merged.
Improvements to existing functionality, bug fixes, and better test coverage are most welcome.
