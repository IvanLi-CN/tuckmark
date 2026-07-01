---
name: tuckmark-template-developer
description: Develop and validate Tuckmark user template packages from inside a cloned Tuckmark source tree.
---

# Tuckmark Template Developer

Use this skill when working inside the Tuckmark repository source tree.

## Contract

- Generate `tuckmark.user-template-package.v1` JSON files.
- Do not call an LLM from Tuckmark CLI; the agent writes the JSON package.
- Validate with the source CLI before using a package.
- Preview and packet generation must go through the existing canvas artifact seam.
- Physical printing is allowed only through explicit owner instruction and the normal `TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1` gate.

## Source Commands

- Validate: `bun tsx packages/cli/src/index.ts template-package validate --file <package.json>`
- Preview: `bun tsx packages/cli/src/index.ts template-package preview --file <package.json>`
- Generate packets: `bun tsx packages/cli/src/index.ts template-package packets --file <package.json>`
- Print after explicit owner approval: `TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 bun tsx packages/cli/src/index.ts template-package print --printer <id> --file <package.json>`
- Focused checks: `bun run --filter @tuckmark/core test`, `bun run --filter @tuckmark/cli test`, and `bun run --filter @tuckmark/web test`

## Package Shape

The package root must include `schema`, `id`, `name`, `description`, `canvas`, `fields`, fixed `elements`, `sampleInput`, and `renderOptions`.

For current P2-class printers, keep printable width at or below `384` dots and monochrome content only.
