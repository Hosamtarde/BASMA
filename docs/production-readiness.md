# Production readiness — pre-production tasks (not in v1)

Items to decide or build before selling the product to other labs (SPEC §2.4). Updated as milestones progress.

| # | Task | Notes |
|---|---|---|
| 1 | Final product name | Replace the `PRODUCT_NAME` placeholder (one constant); check trademark and domain |
| 2 | Code signing | Sign the installer and binaries (avoids SmartScreen warnings) |
| 3 | Licensing / activation | Implement behind the `LicenseService` seam (ADR-0013); subscription model to be decided |
| 4 | Update distribution | v1 = manual installer upgrade; later signed update packages + in-app update check |
| 5 | Installer branding | Product logo, splash, EULA text, «Powered by Smile Artec Dental Laboratory» on splash/login only |
| 6 | Support / diagnostics bundle | Export logs + versions + backup status (no patient data, no secrets) |
| 7 | Backup encryption | Not in v1 (owner, 2026-11-06); password-protected backups to reconsider before selling |
| 8 | Multi-computer / LAN use | Not in v1 (one computer per install); needs TLS + firewall rule + auth review if added |
| 9 | Third-party licences | Notices for Node.js, PostgreSQL, WinSW, Cairo (OFL) and npm dependencies shipped |
| 10 | Clean-VM test matrix | Windows 10/11, install → upgrade → restore → uninstall-keeps-data |
