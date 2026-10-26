# Capri for Linux

What's different from upstream:

- **No Windows, Ollama or Claude Code.** The hooks, the local HTTP bridge and the PowerShell bits are gone.
- **Groq API** for the model: `openai/gpt-oss-120b`, falling back to `openai/gpt-oss-20b`.
- **Linux first.** Built and tested on Arch + Hyprland. The command layer also adapts to Sway, KDE,
  GNOME and X11 (see [Compatibility](#compatibility)).
- **Background services** that do useful things on their own, mostly without calling the model.

The interface (tray menu, her lines, the system prompt) is in Russian.

## Features

### Staying inside Groq's free tier

The free tier allows about 8000 tokens per minute per model, and an agent loop burns through that fast.

- The system prompt is about 2.6k characters (~900 tokens). The environment goes in as one line:
  `Arch Linux | Hyprland/Wayland | kitty | GPU AMD | Batt 90% (сеть) | звук pipewire`.
- Chat history has a budget. Old messages get trimmed, long command output is cut in the middle
  (so stderr at the end survives), and the current task is never dropped.
- Token use is counted per model in a sliding 60 s window. If a request won't fit, it waits for the
  window to free up instead of hitting a 429.
- On a 429 she waits as long as Groq says (`Please try again in 7.66s`) and retries the same model.
  She doesn't jump to the other model, which would only burn its limit too. A daily limit gives a clear
  error instead of a pointless wait.
- Background requests go one at a time, at least 8 s apart, use at most 60 % of the budget and run on
  the 20b model, so the 120b budget stays free for you.

### Background services

- **Watchdog.** A zsh hook reports commands that take longer than 10 s. If you're looking at that
  terminal, she stays quiet. If you switched away, she tells you it finished or failed. Common
  failures are diagnosed locally, with no API call: command not found, permissions, out of memory,
  segfault, pacman lock, network, port in use, missing module, git conflicts. Anything else gets one
  short background request with the output tail (secrets redacted).
- **Arch Update Sentinel.** Every 3 hours: `checkupdates` plus `paru -Qua` / `yay -Qua`. Arch news
  published since your last `-Syu` is checked against the pending packages, so you get warned
  *before* an upgrade that needs manual intervention. After pacman runs it looks for new `.pacnew`
  files and for a kernel that no longer matches the running one.
- **Resource Sentinel.** Notices games (Steam/Proton, gamescope, fullscreen `.exe`, your own window
  classes) and heavy builds.
  - In a game: notifications are held (swaync / mako / dunst go to do-not-disturb), the power profile
    goes to `performance`, Hyprland animations, blur and shadows go off, and the monitor goes to its
    highest refresh rate.
  - Optionally, browsers are frozen with `SIGSTOP`. This is off by default. Processes playing audio
    are never touched, and a rollback journal means everything is restored even if Capri crashes
    mid-game.
  - During a build: only the `performance` profile.
  - Afterwards everything is put back, and you get a summary: time, battery used, peak load, CPU
    temperature.
- **Environment adapter.** Detects the WM, the GPU (sets Chromium flags), battery and power profile,
  and the audio backend. In power-saver mode she draws at half rate and background checks run three
  times less often.

### Hotkeys

- **`SUPER+SHIFT+X` — context snapshot.** One key press collects:
  - the active window;
  - the last 30 lines of the terminal (kitty, wezterm or tmux through their APIs, OCR of the window
    otherwise);
  - the clipboard;
  - git state of the terminal's directory: branch, status, conflicts, unfinished merge/rebase, diff;
  - recent failed commands.

  Secrets are redacted, the snapshot is saved locally and handed to the agent. Code fixes come as
  patches applied with `git apply`, and the confirmation dialog shows the full diff before anything
  changes.
- **`SUPER+SHIFT+R` — intent router.** Select something and press the key. The type is detected
  locally:
  - GitHub/GitLab issue or PR: description, status, labels, last comments;
  - video: metadata, chapters and subtitles via `yt-dlp`;
  - web page, log file, path to a file;
  - an error, a request to change code, a code snippet.

  Links, media and files get a summary right away. Errors and code changes go to the agent loop.
- **`SUPER+SHIFT+L` — her HUD**, a direct line to her. Clicking her also opens it, Escape closes it.

### Also

- **One Capri on screen.** Chromium's single-instance lock lives in the data directory, so two
  launches with different data dirs wouldn't see each other. A second lock, an abstract UNIX socket
  per user, catches that case. A second launch passes its arguments (`--hud`, `--snapshot`,
  `--route`) to the running one and exits.
- **Visuals from upstream:** the intro where she grabs the edges of your screen, eight faces from the
  show in her panel, and her menu on right-click (on her or on her chip) — handy when your bar has
  no tray.
- **Confirmation for risky commands.** She runs commands without asking, except `sudo`, `rm`,
  `kill`, package installs and removals, `git apply`, reboot and the like. Those need your click
  first. Everything she runs is logged to `exec.log`.

## Compatibility

| Session          | Agent commands                    | Overlay              | Tested |
| ---------------- | --------------------------------- | -------------------- | ------ |
| Hyprland         | full (`hyprctl`)                  | window rules below   | yes    |
| Sway             | full (`swaymsg`)                  | write your own rules | no     |
| KDE Wayland      | windows via `kdotool`, input via `ydotool` | write your own rules | no     |
| X11 (any WM)     | full (`xdotool`, `xclip`, `maim`) | click-through works  | no     |
| GNOME Wayland    | no window control, input via `ydotool` | write your own rules | no     |

The overlay is a fullscreen transparent window. On Hyprland, Capri toggles `no_focus` herself when
the pointer gets close to her, so the overlay never steals your input. On other compositors you need
equivalent rules: floating, fullscreen size, no focus, no border or shadow.

## Requirements

- Linux with Node.js 20+ and npm
- A Groq API key: <https://console.groq.com/keys>
- Optional: zsh (for the watchdog hook); kitty with remote control (so Watchdog and snapshots can
  read terminal output without OCR)

## Install

```sh
git clone https://github.com/Hybabybabyba/capri-linux.git ~/src/capri-linux
cd ~/src/capri-linux
./bin/bootstrap.sh
```

`bootstrap.sh` does three things (running it again is safe):

1. **Dependencies.** Installs what's missing through pacman, apt, dnf or zypper: `wtype`, `tesseract`
   (with Russian and English data), `wl-clipboard`, `grim`, `slurp`, `jq`, `playerctl`, `pamixer`,
   `yt-dlp`, `python`, `pciutils`; on Arch also `pacman-contrib`; on X11 `xdotool`, `xclip`, `maim`.
   Then runs `npm ci`.
2. **`GROQ_API_KEY`.** Looks for it in `~/.zshrc`, `~/.bashrc` and your fish config. If there is
   none, it asks for the key and adds it to your shell's config.
3. **The `capri` command.** Links `~/.local/bin/capri`, adds a menu entry and autostart, creates the
   data directory and, if your shell is zsh, offers to add the watchdog hook.

Flags: `--yes` (don't ask), `--no-deps`, `--no-autostart`, `--no-hook`.

Run it:

```sh
capri          # or: npm start
npm run dev    # with logs from both processes
```

### Hyprland config

```ini
# the overlay: a fullscreen transparent window that doesn't take focus
$capri = match:class ^(capri-desktop)$, match:title ^(capri-overlay)$
windowrule = float on, $capri
windowrule = pin on, $capri
windowrule = size (monitor_w) (monitor_h), $capri
windowrule = move 0 0, $capri
windowrule = no_focus on, $capri
windowrule = no_follow_mouse on, $capri
windowrule = border_size 0, $capri
windowrule = no_shadow on, $capri
windowrule = no_blur on, $capri
windowrule = no_anim on, $capri
windowrule = rounding 0, $capri

# the command confirmation dialog: on top, centered
windowrule = float on, match:class ^(capri-desktop)$, match:title ^(Capri: подтверждение)$
windowrule = center on, match:class ^(capri-desktop)$, match:title ^(Capri: подтверждение)$
windowrule = pin on, match:class ^(capri-desktop)$, match:title ^(Capri: подтверждение)$

exec-once = ~/.local/bin/capri

bind = SUPER SHIFT, L, exec, ~/.local/bin/capri --hud
bind = SUPER SHIFT, X, exec, ~/.local/bin/capri --snapshot
bind = SUPER SHIFT, R, exec, ~/.local/bin/capri --route
```

Hyprland doesn't read `~/.config/autostart`, so use `exec-once`. If Capri is already running, those
binds just forward the argument to her; if she isn't, they start her.

### Watchdog and terminal output

The zsh hook (`bootstrap.sh` offers to add it) goes at the end of `~/.zshrc`:

```sh
source ~/src/capri-linux/src/main/hooks/capri.zsh
```

To let her read the output of a failed command in kitty, add to `kitty.conf`:

```ini
allow_remote_control socket-only
listen_on unix:@kitty
shell_integration enabled
```

## Configuration

Settings live in `~/.local/share/capri-desktop/config.json`. Most of them are also in the tray menu
(or her right-click menu) under «Фоновые функции».

| Key            | Default | What it does                                                    |
| -------------- | ------- | --------------------------------------------------------------- |
| `watchdog`     | `true`  | speak up when a long command finishes while you're elsewhere    |
| `diagnose`     | `true`  | send the output tail to Groq when local diagnosis can't tell     |
| `archSentinel` | `true`  | Arch news vs pending updates, `.pacnew`, kernel reboot hint     |
| `gameMode`     | `true`  | game mode when a game starts                                    |
| `gameFreeze`   | `false` | also `SIGSTOP` the apps in `freezeApps` during a game           |
| `gameRefresh`  | `true`  | highest refresh rate on the game's monitor                      |
| `buildBoost`   | `true`  | `performance` profile during heavy builds                       |
| `freezeApps`   | browsers | process names (`comm`) that `gameFreeze` may freeze            |
| `gameClasses`  | a few   | extra window class regexes that count as games                  |
| `gameHooks`    | empty   | `{ "start": "...", "stop": "..." }`, your own shell commands    |

Environment variables:

| Variable            | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `GROQ_API_KEY`      | the key (also read from shell configs if not set)         |
| `GROQ_MODEL`        | use a single model instead of 120b → 20b                  |
| `GROQ_TPM`          | your tokens-per-minute limit, default 8000                |
| `CAPRI_MIN_SECONDS` | watchdog threshold for the zsh hook, default 10           |
| `CAPRI_GPU=off`     | disable hardware acceleration if the overlay flickers     |
| `GH_TOKEN`          | GitHub token for the intent router (`gh auth token` is used too) |
| `GITLAB_TOKEN`      | GitLab token for private projects                         |

Other files in `~/.local/share/capri-desktop/`: `exec.log` (every command she ran),
`hardware_profile.json`, `snapshots/`, `sounds/` (drop your own `.mp3`/`.wav`/`.ogg` there).

## Tools

These are on `PATH` inside her scripts, and you can run them yourself from `src/main/tools/`:

| Tool               | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `context_snapshot` | print the snapshot (`--json` for the raw object)                |
| `intent_router`    | detect the intent of a text or URL and print the gathered material |
| `game_mode`        | `on`, `off`, `status`                                           |
| `media_control`    | player and volume; `sinks` / `sink N` to switch audio output    |
| `sys_info`         | CPU, RAM, battery, windows, workspaces                          |
| `tg_send`          | send a Telegram message to a username or a chat                 |
| `web_action`       | search, fetch page text, open in a browser                      |
| `capri_emit`       | send an event to her background loop                            |

## Privacy

Your requests, the output of the commands she runs, snapshots and selections you route go to Groq.
Secrets that look like tokens, keys, passwords, JWTs and private keys are redacted before anything
leaves your machine. That's a filter, not a guarantee, so don't point her at files full of secrets.
Turning off `diagnose` stops Watchdog from sending command output in the background.

## Building

```sh
npm run dist   # AppImage and tar.gz in dist/
```

## Credits and license

- Original app, sprite rig, animations and the intro: [mochiiwuff](https://github.com/mochiiwuff),
  [capri-desktop](https://github.com/mochiiwuff/capri-desktop).
- This fork: [Hybabybabyba/capri-linux](https://github.com/Hybabybabyba/capri-linux).
- Capri / Project Capricorn, Cyberpunk and Cyberpunk: Edgerunners belong to CD PROJEKT RED, Studio
  Trigger and Netflix. This is a non-commercial fan project with no affiliation. The character images
  in `assets/capri/` come from frames of the show and a fan-made cut-out, and they are **not** covered
  by the MIT license. If a rights holder wants them removed, open an issue.
- Fonts: Chakra Petch and JetBrains Mono, SIL Open Font License, via Fontsource.

The code is MIT, see [LICENSE](LICENSE).

## Быстрый старт

```sh
git clone https://github.com/Hybabybabyba/capri-linux.git ~/src/capri-linux
cd ~/src/capri-linux
./bin/bootstrap.sh     # зависимости, ключ Groq, команда capri, ярлык и автозапуск
capri                  # или npm start
```

1. Ключ Groq берётся из `~/.zshrc`, `~/.bashrc` или конфига fish. Если его там нет, `bootstrap.sh`
   спросит ключ и сам пропишет `export GROQ_API_KEY=...`.
2. Добавь в конфиг Hyprland правила окон и бинды из раздела [Hyprland config](#hyprland-config). Без
   правил оверлей будет вести себя как обычное окно.
3. Клик по Капри открывает её HUD: пиши, что сделать. `SUPER+SHIFT+X` разбирает, что свалилось в
   терминале, `SUPER+SHIFT+R` разбирает выделенный текст или ссылку.
4. Настройки — в трее или в меню по правому клику на Капри, файл:
   `~/.local/share/capri-desktop/config.json`.
