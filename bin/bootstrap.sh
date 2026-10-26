#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
APP_DATA="$DATA/capri-desktop"

usage() {
  cat <<'EOF'
Развернуть Капри на новой машине из исходников:
  1) системные зависимости через pacman / apt / dnf / zypper (только недостающее);
  2) npm-зависимости (electron);
  3) GROQ_API_KEY из ~/.zshrc, ~/.bashrc или fish, иначе спросит и пропишет;
  4) каталоги данных, ~/.local/bin/capri, ярлык в меню и автозапуск;
  5) zsh-хук watchdog'а.

  bin/bootstrap.sh [--yes] [--no-deps] [--no-autostart] [--no-hook]
EOF
}

YES=0 DEPS=1 AUTOSTART=1 HOOK=1
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    --no-deps) DEPS=0 ;;
    --no-autostart) AUTOSTART=0 ;;
    --no-hook) HOOK=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "bootstrap: неизвестный флаг $arg (--help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'; else B='' G='' Y='' R='' N=''; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

ask() {
  [ "$YES" = 1 ] && return 0
  [ -t 0 ] || return 1
  local reply
  read -r -p "  $1 [Y/n] " reply
  [[ -z "$reply" || "$reply" =~ ^[YyДд] ]]
}

[ "$(id -u)" != 0 ] || fail 'запускай от своего пользователя, а не root: sudo спросят, когда понадобится'

session_type() {
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then echo wayland
  elif [ -n "${DISPLAY:-}" ]; then echo x11
  else echo "${XDG_SESSION_TYPE:-wayland}"
  fi
}

install_deps() {
  step 'Системные зависимости'
  local pm='' pkgs=() x11=() node=() install=()
  for p in pacman apt-get dnf zypper; do command -v "$p" >/dev/null && { pm="$p"; break; }; done
  case "$pm" in
    pacman)
      pkgs=(wtype tesseract tesseract-data-rus tesseract-data-eng wl-clipboard grim slurp jq playerctl pamixer pciutils pacman-contrib python yt-dlp)
      x11=(xdotool xclip maim); node=(nodejs npm)
      query() { pacman -Qq "$1" >/dev/null 2>&1; }
      install=(sudo pacman -S --needed) ;;
    apt-get)
      pkgs=(wtype tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng wl-clipboard grim slurp jq playerctl pamixer pciutils python3 yt-dlp)
      x11=(xdotool xclip maim); node=(nodejs npm)
      query() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }
      install=(sudo apt-get install -y) ;;
    dnf)
      pkgs=(wtype tesseract tesseract-langpack-rus tesseract-langpack-eng wl-clipboard grim slurp jq playerctl pamixer pciutils python3 yt-dlp)
      x11=(xdotool xclip maim); node=(nodejs npm)
      query() { rpm -q "$1" >/dev/null 2>&1; }
      install=(sudo dnf install -y) ;;
    zypper)
      pkgs=(wtype tesseract-ocr tesseract-ocr-traineddata-russian tesseract-ocr-traineddata-english wl-clipboard grim slurp jq playerctl pamixer pciutils python3 yt-dlp)
      x11=(xdotool xclip maim); node=(nodejs-default npm-default)
      query() { rpm -q "$1" >/dev/null 2>&1; }
      install=(sudo zypper install -y) ;;
    *)
      warn 'пакетный менеджер не распознан (нужен pacman, apt, dnf или zypper) — поставь вручную:'
      warn 'wtype tesseract (+русский язык) wl-clipboard grim slurp jq playerctl pamixer, на X11: xdotool xclip maim'
      return ;;
  esac
  [ "$(session_type)" = x11 ] && pkgs+=("${x11[@]}")
  command -v node >/dev/null || pkgs+=("${node[@]}")

  local missing=()
  for p in "${pkgs[@]}"; do query "$p" || missing+=("$p"); done
  if [ "${#missing[@]}" -eq 0 ]; then ok "всё уже стоит ($pm)"; return; fi
  echo "  не хватает: ${missing[*]}"
  if ask "Установить через $pm?"; then
    [ "$pm" = apt-get ] && sudo apt-get update -qq
    "${install[@]}" "${missing[@]}" || warn 'часть пакетов не установилась — проверь вывод выше'
  else
    warn "пропущено: ${install[*]} ${missing[*]}"
  fi
  case "${XDG_CURRENT_DESKTOP,,}" in
    *kde*|*plasma*) command -v kdotool >/dev/null || warn 'KDE Wayland: для управления окнами нужен kdotool (AUR / cargo install kdotool), для ввода — ydotool' ;;
    *gnome*) warn 'GNOME Wayland: окнами управлять нечем, для ввода нужен ydotool' ;;
  esac
}

install_node_modules() {
  step 'Зависимости Node.js'
  command -v npm >/dev/null || fail 'нет npm — поставь nodejs и npm и запусти снова'
  if [ -x "$ROOT/node_modules/.bin/electron" ]; then ok 'node_modules на месте'; return; fi
  (cd "$ROOT" && if [ -f package-lock.json ]; then npm ci; else npm install; fi)
  ok 'установлены'
}

FISH_DIR="$CONFIG/fish"

find_key() {
  {
    sed -nE 's/^[[:space:]]*(export[[:space:]]+)?GROQ_API_KEY=(.*)$/\2/p' ~/.zshrc ~/.bashrc
    sed -nE 's/^[[:space:]]*set[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*GROQ_API_KEY[[:space:]]+(.*)$/\2/p' \
      "$FISH_DIR/config.fish" "$FISH_DIR"/conf.d/*.fish
    sed -nE 's/^SETUVAR[[:space:]]+(--export[[:space:]]+)?GROQ_API_KEY:(.*)$/\2/p' "$FISH_DIR/fish_variables"
  } 2>/dev/null | sed 's/[[:space:]]#.*//' | tr -dc 'A-Za-z0-9_\n-' | grep '^gsk_' | tail -n1 || true
}

setup_key() {
  step 'GROQ_API_KEY'
  local key
  key="$(find_key)"
  if [ -n "$key" ]; then ok "найден в конфиге шелла (${key:0:8}…) — Капри и bin/capri подтянут его сами"; return; fi
  if [[ "${GROQ_API_KEY:-}" == gsk_* ]]; then
    key="$GROQ_API_KEY"
    warn 'ключ есть только в текущем окружении — пропишу его в конфиг шелла, чтобы он был и при автозапуске'
  elif [ -t 0 ]; then
    read -r -s -p '  Ключ Groq (gsk_…, https://console.groq.com/keys; Enter — пропустить): ' key; echo
    key="$(printf '%s' "$key" | tr -dc 'A-Za-z0-9_-')"
    [ -n "$key" ] || { warn 'пропущено: без ключа Капри не сможет отвечать'; return; }
    [[ "$key" == gsk_* ]] || { warn 'это не похоже на ключ Groq (должен начинаться с gsk_) — пропущено'; return; }
  else
    warn 'ключа нет, а спросить негде (не терминал) — пропиши export GROQ_API_KEY=… в ~/.zshrc или ~/.bashrc'
    return
  fi

  local rc line
  case "$(basename "${SHELL:-bash}")" in
    zsh) rc="$HOME/.zshrc"; line="export GROQ_API_KEY=\"$key\"" ;;
    fish) rc="$FISH_DIR/conf.d/capri.fish"; line="set -gx GROQ_API_KEY \"$key\""; mkdir -p "$FISH_DIR/conf.d" ;;
    *) rc="$HOME/.bashrc"; line="export GROQ_API_KEY=\"$key\"" ;;
  esac
  printf '\n# Capri: ключ Groq\n%s\n' "$line" >> "$rc"
  ok "записан в $rc"
}

desktop_entry() {
  cat <<EOF
[Desktop Entry]
Type=Application
Name=Capri
GenericName=Desktop companion
Comment=Автономный ассистент рабочего стола (Groq)
Exec=$ROOT/bin/capri
Icon=$ROOT/assets/icons/capri.png
Terminal=false
Categories=Utility;
StartupWMClass=capri-desktop
EOF
}

setup_desktop() {
  step 'Каталоги и ярлыки'
  mkdir -p "$APP_DATA/sounds" "$HOME/.local/bin" "$DATA/applications"
  chmod +x "$ROOT/bin/capri" "$ROOT"/src/main/tools/*
  ok "данные: $APP_DATA (свои звуки — в sounds/)"

  ln -sfn "$ROOT/bin/capri" "$HOME/.local/bin/capri"
  ok '~/.local/bin/capri'
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn '~/.local/bin нет в PATH — добавь его, чтобы вызывать capri по имени' ;; esac

  desktop_entry > "$DATA/applications/capri-desktop.desktop"
  command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
  ok 'ярлык в меню приложений'

  [ "$AUTOSTART" = 1 ] || return 0
  if [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] || [ -n "${SWAYSOCK:-}" ]; then
    local wm=Hyprland dir="$CONFIG/hypr" conf='exec-once = capri'
    [ -n "${SWAYSOCK:-}" ] && wm=Sway dir="$CONFIG/sway" conf='exec capri'
    if grep -rqsi 'capri-desktop\|bin/capri\|exec.*capri' "$dir"; then
      ok "автозапуск: Капри уже запускается из $dir"
    else
      warn "автозапуск в $wm — добавь в $dir: $conf"
    fi
  else
    mkdir -p "$CONFIG/autostart"
    { desktop_entry; echo 'X-GNOME-Autostart-enabled=true'; } > "$CONFIG/autostart/capri-desktop.desktop"
    ok 'автозапуск: ~/.config/autostart/capri-desktop.desktop'
  fi
}

setup_hook() {
  [ "$HOOK" = 1 ] && [ "$(basename "${SHELL:-}")" = zsh ] || return 0
  step 'zsh-хук watchdog (долгие команды)'
  local line="source \"$ROOT/src/main/hooks/capri.zsh\""
  if grep -qs 'hooks/capri.zsh' ~/.zshrc; then ok 'уже подключён'; return; fi
  if ask 'Добавить в конец ~/.zshrc?'; then
    printf '\n# Capri: сообщать о долгих командах\n%s\n' "$line" >> ~/.zshrc
    ok 'подключён (сработает в новых терминалах)'
  else
    warn "пропущено, вручную: $line"
  fi
}

printf '%sCapri bootstrap%s — %s\n' "$B" "$N" "$ROOT"
[ "$DEPS" = 1 ] && install_deps
install_node_modules
setup_key
setup_desktop
setup_hook
step 'Готово'
echo "  Запуск: capri (или $ROOT/bin/capri). Профиль железа появится в $APP_DATA/hardware_profile.json"
