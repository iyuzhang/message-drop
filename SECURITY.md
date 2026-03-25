# Security policy

## Supported versions

Security fixes are applied to the **latest release branch or default branch** as chosen by maintainers. Older tags may not receive backports unless explicitly stated in a release note.

## Reporting a vulnerability

**Please do not file public GitHub issues for undisclosed security vulnerabilities.**

Instead, report details privately:

1. Use GitHub **Security Advisories** for this repository (preferred): *Security* → *Advisories* → *Report a vulnerability*, if enabled for the repo.
2. If that is unavailable, contact repository maintainers through a private channel they publish in the repo description or organization profile.

Include:

- A short description of the issue and its impact
- Steps to reproduce (proof-of-concept if safe)
- Affected versions or commit SHAs if known
- Your suggestion for a fix (optional)

We aim to acknowledge reports within a few business days and coordinate disclosure after a fix is available.

## Scope

In scope: the message-drop server, bundled web UI, Android wrapper, and CLI when used as documented. Out of scope: generic issues in upstream dependencies unless we can mitigate them in this repo.

## Debug endpoint (`/debug`)

The HTTP route **`/debug`** returns operational snapshots (for example recent messages and connection counts). It is meant for **trusted LAN or local development only** and has **no authentication**. Do **not** expose it on the public internet: bind the server to a loopback or private interface when you only need local access, and use host firewalls or cloud security groups so the listen port is reachable only from networks you trust.

## Safe harbor

We appreciate responsible disclosure and will not pursue legal action against researchers who follow this policy and act in good faith.
