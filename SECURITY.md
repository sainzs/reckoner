# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Reckoner, please report it responsibly.

### How to Report

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email: **sainzs@users.noreply.github.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Assessment**: We will assess the vulnerability within 7 days
- **Resolution**: We will work to resolve critical vulnerabilities within 30 days
- **Disclosure**: We will coordinate disclosure with you after a fix is available

### Security Considerations

Reckoner is a **pi package** that provides memory, verification, and guardrails for AI coding agents. Security considerations include:

1. **Agent Memory**: Reckoner stores lessons and task state in `.pi/memory/` as markdown files. These files are human-readable and do not contain executable code.

2. **File System Access**: Reckoner reads/writes files within the project directory and `.pi/` metadata directory. It should never access sensitive system files.

3. **Verification Commands**: The `auto-verify` extension runs typecheck and test commands. These commands are defined in `package.json` and should be reviewed before use.

4. **Guardrails**: Reckoner includes safety checks (e.g., blocking writes to `.env`, `~/.ssh`). These are defensive measures, not security guarantees.

5. **Peer Dependencies**: Reckoner depends on `@mariozechner/pi-coding-agent` and related packages. Security updates to these dependencies should be applied promptly.

### Security Best Practices

When using Reckoner:

- Review verification commands in `package.json` before running
- Do not install Reckoner in untrusted repositories
- Keep pi and Reckoner updated to benefit from security patches
- Review `.pi/memory/` files before sharing them

## Security Updates

Security updates will be released as patch versions (e.g., 0.1.0 → 0.1.1) and announced via GitHub Security Advisories.

## Responsible Disclosure

We appreciate responsible disclosure. If you report a valid security vulnerability, we will:

- Credit you in the security advisory (unless you prefer to remain anonymous)
- Mention your contribution in the CHANGELOG
- Work with you to understand and resolve the issue

Thank you for helping keep this project secure.
