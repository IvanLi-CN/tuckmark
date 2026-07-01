---
name: tuckmark-template-user
description: Generate, validate, preview, and print Tuckmark template packages with the released CLI outside the Tuckmark source repository.
---

# Tuckmark Template User

Use this skill when the current directory is not the Tuckmark source repository.

## Contract

- Write a `tuckmark.user-template-package.v1` JSON file for the label.
- Use the released `tuckmark` CLI, not repository source commands.
- Tuckmark CLI validates, previews, generates packets, and prints; it does not generate the template with an embedded LLM.
- Do not physically print unless the owner explicitly asks for it.

## Released CLI Commands

- Validate: `tuckmark template-package validate --file <package.json>`
- Preview: `tuckmark template-package preview --file <package.json>`
- Generate packets: `tuckmark template-package packets --file <package.json>`
- Print after explicit owner approval: `TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 tuckmark template-package print --printer <id> --file <package.json>`

## Template Guidance

- Use fixed elements only: `text`, `rect`, `line`, `barcode`, and `qr`.
- Keep canvas width at or below `384` dots for the current printer capability.
- Prefer compact electronics labels with two to three readable text lines for small organizer boxes.
- Use `sampleInput` to show the intended rendered result.
