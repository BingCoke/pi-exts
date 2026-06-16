# Pi Personal Tools

Personal Pi package containing:

- `last-ai`: `/last-ai [n]` opens recent assistant messages in an external editor and inserts the reply section back into Pi.
- `image-tool`: `generate_image` calls an OpenAI-compatible image API and saves generated images locally.
- `ssh-copy`: `Alt+V` image paste over SSH using `pi-image-bridge` and SSH `RemoteForward`.

## Install locally

```bash
npm install
pi install ./ --approve
```

## One-time image bridge setup

```bash
npm run bridge:install
npm run bridge:doctor
```

`pi-image-bridge install` is zero-argument by default. It installs local autostart and writes a managed SSH config block for no-touch use:

```sshconfig
# >>> pi-image-bridge
Host *
  RemoteForward 127.0.0.1:38991 127.0.0.1:38991
  ExitOnForwardFailure no
# <<< pi-image-bridge
```

After setup, start Pi normally. In SSH sessions, press `Alt+V` to paste a local clipboard image into the remote Pi editor.

macOS clipboard paste has no `pngpaste`, Swift, or AppleScript fallback in v1. It only works if the optional native clipboard dependency can read images on the machine.
