# Undo, versions and backups (v0.14)

## Undo and redo (whole project)
Undo and Redo are in the left rail whenever a project is open, and Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work anywhere except inside a text box (which keeps its own undo). They cover the script, cast, directions, notes, timeline, music, ducking, atmosphere, picture and export settings. The Timeline's Undo and Redo buttons are the same thing.

- A quick run of the same kind of change (typing, a slider, arrow-key nudges) is one step. Up to 100 steps are kept while the project is open.
- **Making a take ends the undo history.** Takes cost credits and cannot be remade for free, so no undo can leave a take without its line. Changes made after the take can be undone; to go back further, use a version.
- Undo never removes a take or the spending ledger, even when it goes back past them.

## Versions
A version is a small copy of `project.json` kept in `projects\<id>\versions`. One is saved when you open or close a project, automatically when saving if the newest one is over ten minutes old, and whenever you press **Keep this version now** on the History screen. The newest 60 are kept. **Restore** puts that state back (and keeps today's first as "before restore"), and it can also be undone with Undo. Takes made since are kept.

## Backups
A backup is one zip in `Documents\Greenroom\backups` holding the project and every take, with a manifest of sizes and SHA-256 fingerprints. One is made automatically the first time you open a project each day, the newest five of each project are kept, and **Back up now** makes one on demand. **Open as a new project** restores a backup as a new project, "(restored)", and never overwrites anything. Before writing a single file it checks every file's size and fingerprint and refuses anything unexpected (a path outside the takes folder, a changed take, a newer format).

## Checked
Rust unit tests: time stamps, version labels, skipping unchanged states, the ten-minute rule, pruning to 60, backup and restore of project and takes, a tampered take and a hostile manifest restoring nothing, daily automatic backups with pruning. Front-end tests for the history and for not losing takes or the ledger. In demo mode: undo, redo and Ctrl+Z, takes surviving, the History screen, a backup opened as a new project.

## Not checked
Very large projects (hundreds of MB of takes are read into memory while backing up), a backup copied to another computer, and restoring across Greenroom versions. Backups are not encrypted.
