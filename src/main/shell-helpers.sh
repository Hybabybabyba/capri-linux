export YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-$XDG_RUNTIME_DIR/.ydotool_socket}"

if [ -z "${CAPRI_WINDOW_TOOL:-}" ]; then
  if [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then CAPRI_WINDOW_TOOL=hyprctl
  elif [ -n "${SWAYSOCK:-}" ]; then CAPRI_WINDOW_TOOL=swaymsg
  elif [ -z "${WAYLAND_DISPLAY:-}" ] && [ -n "${DISPLAY:-}" ] && command -v xdotool >/dev/null; then CAPRI_WINDOW_TOOL=xdotool
  elif command -v kdotool >/dev/null; then CAPRI_WINDOW_TOOL=kdotool
  else CAPRI_WINDOW_TOOL=none
  fi
fi

_capri_x11() { [ -z "${WAYLAND_DISPLAY:-}" ] && [ -n "${DISPLAY:-}" ]; }

_capri_wtype() {
  command -v wtype >/dev/null || return 1
  case "${CAPRI_WM:-${XDG_CURRENT_DESKTOP,,}}" in *kde*|*plasma*|*gnome*) return 1 ;; esac
}

_capri_clip_get() { if _capri_x11; then xclip -selection clipboard -o 2>/dev/null; else wl-paste -n 2>/dev/null; fi; }
_capri_clip_set() { if _capri_x11; then xclip -selection clipboard; else wl-copy; fi; }

_capri_ydo() {
  if [ ! -S "$YDOTOOL_SOCKET" ]; then
    setsid -f ydotoold --socket-path="$YDOTOOL_SOCKET" --socket-own="$(id -u):$(id -g)" >/dev/null 2>&1
    for _ in 1 2 3 4 5 6 7 8 9 10; do [ -S "$YDOTOOL_SOCKET" ] && break; sleep 0.1; done
  fi
  ydotool "$@" >/dev/null
}

declare -A _CAPRI_KEY=(
  [Return]=28 [Enter]=28 [Tab]=15 [Escape]=1 [BackSpace]=14 [Delete]=111 [space]=57
  [Up]=103 [Down]=108 [Left]=105 [Right]=106 [Home]=102 [End]=107 [Page_Up]=104 [Page_Down]=109
  [F1]=59 [F2]=60 [F3]=61 [F4]=62 [F5]=63 [F6]=64 [F7]=65 [F8]=66 [F9]=67 [F10]=68 [F11]=87 [F12]=88
  [ctrl]=29 [shift]=42 [alt]=56 [super]=125
  [a]=30 [b]=48 [c]=46 [d]=32 [e]=18 [f]=33 [g]=34 [h]=35 [i]=23 [j]=36 [k]=37 [l]=38 [m]=50
  [n]=49 [o]=24 [p]=25 [q]=16 [r]=19 [s]=31 [t]=20 [u]=22 [v]=47 [w]=17 [x]=45 [y]=21 [z]=44
  [1]=2 [2]=3 [3]=4 [4]=5 [5]=6 [6]=7 [7]=8 [8]=9 [9]=10 [0]=11
)

key() {
  _capri_check_focus || return 1
  if _capri_x11; then xdotool key --clearmodifiers "$1"; return; fi
  if _capri_wtype; then wtype -k "$1"; return; fi
  local code="${_CAPRI_KEY[$1]}"
  [ -n "$code" ] || { echo "key: не знаю клавишу '$1'" >&2; return 1; }
  _capri_ydo key "$code:1" "$code:0"
}

combo() {
  _capri_check_focus || return 1
  local mods=("${@:1:$#-1}") last="${!#}" m
  if _capri_x11; then xdotool key --clearmodifiers "$(IFS=+; echo "$*")"; return; fi
  if _capri_wtype; then
    local args=()
    for m in "${mods[@]}"; do args+=(-M "$m"); done
    args+=(-k "$last")
    for m in "${mods[@]}"; do args+=(-m "$m"); done
    wtype "${args[@]}"
    return
  fi
  local down=() up=() code
  for m in "${mods[@]}" "$last"; do
    code="${_CAPRI_KEY[$m]}"
    [ -n "$code" ] || { echo "combo: не знаю клавишу '$m'" >&2; return 1; }
    down+=("$code:1"); up=("$code:0" "${up[@]}")
  done
  _capri_ydo key "${down[@]}" "${up[@]}"
}

paste_text() {
  _capri_check_focus || return 1
  local text="$*" old
  old="$(_capri_clip_get)"
  printf '%s' "$text" | _capri_clip_set
  sleep 0.15
  combo ctrl v
  sleep 0.3
  if [ -n "$old" ]; then printf '%s' "$old" | _capri_clip_set; fi
}

type_text() {
  _capri_check_focus || return 1
  local text="$*"
  if [[ "$text" != *$'\n'* ]]; then
    if _capri_x11; then xdotool type --clearmodifiers -- "$text"; return; fi
    if _capri_wtype; then wtype -- "$text"; return; fi
  fi
  paste_text "$text"
}

_capri_app() {
  case "${1,,}" in
    telegram|tg) _CAPRI_RE='^(org\.telegram\.desktop|TelegramDesktop)$'; _CAPRI_NAME=Telegram ;;
    discord|vesktop) _CAPRI_RE='^(vesktop|discord)$'; _CAPRI_NAME=Discord ;;
    floorp) _CAPRI_RE='^floorp$'; _CAPRI_NAME=Floorp ;;
    librewolf) _CAPRI_RE='^(LibreWolf|librewolf)$'; _CAPRI_NAME=LibreWolf ;;
    firefox) _CAPRI_RE='^firefox$'; _CAPRI_NAME=Firefox ;;
    zen) _CAPRI_RE='^zen$'; _CAPRI_NAME=Zen ;;
    browser) _CAPRI_RE='^(floorp|LibreWolf|librewolf|firefox|zen)$'; _CAPRI_NAME=браузер ;;
    *)
      _CAPRI_RE="$1"; _CAPRI_NAME="$1"
      [[ "$1" =~ org\\?\.telegram|TelegramDesktop ]] && _CAPRI_NAME=Telegram
      [[ "$1" =~ vesktop|discord ]] && _CAPRI_NAME=Discord
      ;;
  esac
}

_capri_active_class() {
  case "$CAPRI_WINDOW_TOOL" in
    hyprctl) hyprctl activewindow -j | jq -r '.class // ""' ;;
    swaymsg) swaymsg -t get_tree | jq -r 'first(.. | objects | select(.focused? == true)) | .app_id // .window_properties.class // ""' ;;
    xdotool|kdotool) "$CAPRI_WINDOW_TOOL" getactivewindow getwindowclassname 2>/dev/null ;;
  esac
}

_CAPRI_SWAY_SEL='.. | objects | select(.pid? != null and ((.app_id // .window_properties.class // "") | test($re)))'

_capri_focus_class() {
  local id
  case "$CAPRI_WINDOW_TOOL" in
    hyprctl) hyprctl dispatch focuswindow "class:$1" >/dev/null ;;
    swaymsg)
      id="$(swaymsg -t get_tree | jq -r --arg re "$1" "first($_CAPRI_SWAY_SEL) | .id")"
      [ -n "$id" ] && swaymsg "[con_id=$id] focus" >/dev/null ;;
    xdotool|kdotool)
      id="$("$CAPRI_WINDOW_TOOL" search --class "$1" 2>/dev/null | head -n1)"
      [ -n "$id" ] && "$CAPRI_WINDOW_TOOL" windowactivate "$id" ;;
    *) echo "focus: в этой сессии нет инструмента управления окнами" >&2; return 1 ;;
  esac
}

CAPRI_FOCUS_RE=''
CAPRI_FOCUS_NAME=''

_capri_check_focus() {
  [ -n "$CAPRI_FOCUS_RE" ] || return 0
  local cls
  cls="$(_capri_active_class)"
  if ! [[ "$cls" =~ $CAPRI_FOCUS_RE ]]; then
    echo "Ошибка: Фокус не на $CAPRI_FOCUS_NAME, а на ${cls:-пустом месте}" >&2
    return 1
  fi
}

focus() {
  _capri_app "$1"
  CAPRI_FOCUS_RE="$_CAPRI_RE"; CAPRI_FOCUS_NAME="$_CAPRI_NAME"
  _capri_focus_class "$_CAPRI_RE"
  sleep 0.3
  _capri_check_focus
}

send_message() {
  focus "$1" || return 1
  type_text "${*:2}"
  sleep 0.1
  key Return
}

_capri_grab() {
  local file="$1"; shift
  if _capri_x11; then
    if command -v maim >/dev/null; then maim ${4:+-g "${3}x${4}+${1}+${2}"} "$file"
    else import -window root ${4:+-crop "${3}x${4}+${1}+${2}"} "$file"
    fi
  else
    grim ${4:+-g "$1,$2 ${3}x${4}"} "$file"
  fi
}

_capri_ocr() {
  local langs=eng
  tesseract --list-langs 2>/dev/null | grep -qx rus && langs=rus+eng
  tesseract "$1" - -l "$langs" 2>/dev/null
}

screenshot() {
  local file="${1:-$HOME/Pictures/capri-$(date +%F_%H-%M-%S).png}"
  mkdir -p "$(dirname "$file")"
  _capri_grab "$file" && echo "$file"
}

screen_text() {
  local img geo=()
  img="$(mktemp --suffix=.png)"
  if [ -n "$1" ]; then
    read -r -a geo <<< "$(window_geometry "$1")"
    [ "${#geo[@]}" -eq 4 ] || { echo "screen_text: окно '$1' не найдено" >&2; rm -f "$img"; return 1; }
  fi
  _capri_grab "$img" "${geo[@]}" || { rm -f "$img"; return 1; }
  _capri_ocr "$img"
  rm -f "$img"
}

region_text() {
  local img
  [[ "$1" =~ ^(-?[0-9]+),(-?[0-9]+)\ ([0-9]+)x([0-9]+)$ ]] || { echo 'region_text: нужно "x,y wxh"' >&2; return 2; }
  img="$(mktemp --suffix=.png)"
  _capri_grab "$img" "${BASH_REMATCH[@]:1:4}" || { rm -f "$img"; return 1; }
  _capri_ocr "$img"
  rm -f "$img"
}

window_geometry() {
  local id
  case "$CAPRI_WINDOW_TOOL" in
    hyprctl) hyprctl clients -j | jq -r --arg re "$1" \
      'first(.[] | select(.class | test($re))) | "\(.at[0]) \(.at[1]) \(.size[0]) \(.size[1])"' ;;
    swaymsg) swaymsg -t get_tree | jq -r --arg re "$1" \
      "first($_CAPRI_SWAY_SEL) | \"\(.rect.x) \(.rect.y) \(.rect.width) \(.rect.height)\"" ;;
    xdotool|kdotool)
      id="$("$CAPRI_WINDOW_TOOL" search --class "$1" 2>/dev/null | head -n1)"
      [ -n "$id" ] && "$CAPRI_WINDOW_TOOL" getwindowgeometry --shell "$id" \
        | awk -F= '$1=="X"{x=$2} $1=="Y"{y=$2} $1=="WIDTH"{w=$2} $1=="HEIGHT"{h=$2} END{if (w) print x, y, w, h}' ;;
  esac
}

launch() {
  case "$CAPRI_WINDOW_TOOL" in
    hyprctl) hyprctl dispatch exec "$*" >/dev/null ;;
    swaymsg) swaymsg exec "$*" >/dev/null ;;
    *) setsid -f sh -c "$*" >/dev/null 2>&1 ;;
  esac
}

urlencode() { jq -rn --arg s "$*" '$s|@uri'; }

open_url() { setsid -f xdg-open "$1" >/dev/null 2>&1; }

web_search() { open_url "https://www.google.com/search?q=$(urlencode "$*")"; }
