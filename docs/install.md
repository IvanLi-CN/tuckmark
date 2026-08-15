# Install Tuckmark Host Tools

Tuckmark releases are self-contained host-tool archives. There is no installer
script, package-manager formula, or automatic PATH modification. Download the
archive for the host platform and `SHA256SUMS` from the same GitHub Release,
verify the archive, extract it, then place its contents at the stable paths
below.

Each archive contains exactly these release-facing parts:

- `bin/tuckmark` and `bin/tuckmark-devd` (with `.exe` on Windows)
- private `libexec/tuckmark/tuckmark-detonger` and
  `libexec/tuckmark/tuckmark-detonger-preview-encoder`
- released Skills under `skills/tuckmark-agent-import` and
  `skills/tuckmark-templates`

The helper programs are private runtime dependencies. Do not add `libexec` to
PATH or invoke those helpers as a public interface.

## Verify

On macOS, verify the downloaded archive before extracting it:

```sh
grep 'tuckmark-host-tools-darwin-arm64.tar.gz' SHA256SUMS | shasum -a 256 -c -
```

Use `darwin-x64` instead for Intel Macs. On Linux, use the matching Linux
asset and checksum command:

```sh
grep 'tuckmark-host-tools-linux-x64.tar.gz' SHA256SUMS | sha256sum -c -
```

On Windows, compare the `SHA256` value reported by the following command with
the matching `tuckmark-host-tools-windows-x64.zip` line in `SHA256SUMS`:

```powershell
Get-FileHash .\tuckmark-host-tools-windows-x64.zip -Algorithm SHA256
```

## macOS and Linux

Extract the archive, then manually copy its `bin` and `libexec` contents into
the stable, unversioned layout. This example uses macOS arm64; replace the
archive and extracted directory name for a different Unix target.

```sh
tar -xzf tuckmark-host-tools-darwin-arm64.tar.gz
RELEASE_ROOT="$PWD/tuckmark-darwin-arm64"
mkdir -p "$HOME/.local/bin" "$HOME/.local/libexec/tuckmark"
cp "$RELEASE_ROOT/bin/tuckmark" "$RELEASE_ROOT/bin/tuckmark-devd" "$HOME/.local/bin/"
cp "$RELEASE_ROOT/libexec/tuckmark/"* "$HOME/.local/libexec/tuckmark/"
```

Add `~/.local/bin` to PATH through the user's normal shell configuration only
when it is not already present. Tuckmark does not change PATH automatically.

Run `tuckmark --version` and `tuckmark-devd --version`. Each prints the release
version, complete merge SHA, and target triple. macOS builds are ad-hoc signed;
they are not Developer ID notarized.

## Windows

Extract the ZIP and manually copy its contents into the stable program path.
The first Windows release is unsigned.

```powershell
Expand-Archive .\tuckmark-host-tools-windows-x64.zip -DestinationPath .\tuckmark-release
$releaseRoot = Join-Path $PWD 'tuckmark-release\tuckmark-windows-x64'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Tuckmark'
New-Item -ItemType Directory -Force "$installRoot\bin", "$installRoot\libexec\tuckmark"
Copy-Item "$releaseRoot\bin\*" "$installRoot\bin\"
Copy-Item "$releaseRoot\libexec\tuckmark\*" "$installRoot\libexec\tuckmark\"
```

The stable executable directory is `%LOCALAPPDATA%\Programs\Tuckmark\bin`.
Add it to PATH manually only when desired; Tuckmark does not alter the user or
system PATH.

## Install Release Skills

After checksum verification and extraction, install only the two released
Skills from the extracted release root. This command uses `npx` only to install
Skills globally; the Tuckmark executables themselves do not need Node or Bun.

```sh
npx --yes skills add <release-root> --skill tuckmark-agent-import --skill tuckmark-templates -g -y
```

Replace `<release-root>` with the extracted `tuckmark-<target>` directory. Do
not install either `-source` Skill from a release archive: source Skills belong
to a cloned development checkout under `.agents/skills/`.
