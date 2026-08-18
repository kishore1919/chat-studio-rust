# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

Only the latest release on the `main` branch receives security updates.

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities via public GitHub issues.**

Instead, please email us at **security@your-domain.com** (or use [GitHub Security Advisories](https://github.com/your-org/chat_studio/security/advisories/new)).

Include the following information:
- Type of vulnerability (e.g., XSS, RCE, information disclosure, etc.)
- Full description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations or fixes

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Security Considerations for Users

### API Keys
- API keys are stored locally in `settings.toml` with file permissions `0600` (Unix) or equivalent ACLs (Windows)
- Keys are redacted in error logs and UI displays
- Never commit `settings.toml` to version control

### Network
- The app makes outbound HTTPS requests only to configured provider endpoints
- No telemetry or analytics are sent by default
- MCP servers run as child processes with stdio transport (no network exposure unless the MCP server itself makes network calls)

### Data Storage
- Conversation history is stored in a local SQLite database
- No cloud sync or remote storage is implemented
- Database file location follows OS conventions (see README)

### Build Verification
- Release binaries are built via GitHub Actions (see `.github/workflows/ci.yml`)
- Verify checksums against the release assets if building from source