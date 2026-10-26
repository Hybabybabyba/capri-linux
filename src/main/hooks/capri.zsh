[[ -o interactive ]] || return 0
zmodload zsh/datetime zsh/net/socket 2>/dev/null || return 0

typeset -g _CAPRI_SOCK="${CAPRI_SOCKET:-${XDG_RUNTIME_DIR:-/tmp/capri-$UID}/capri/events.sock}"
typeset -g _capri_cmd=''
typeset -gF _capri_t0=0

_capri_json() {
  local s=$1
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//[[:cntrl:]]/}
  print -rn -- "\"$s\""
}

_capri_preexec() {
  _capri_cmd=$1
  _capri_t0=$EPOCHREALTIME
}

_capri_precmd() {
  local code=$?
  (( _capri_t0 > 0 )) || return 0
  local -i ms=$(( (EPOCHREALTIME - _capri_t0) * 1000 ))
  local cmd=$_capri_cmd
  _capri_t0=0 _capri_cmd=''
  (( ms >= ${CAPRI_MIN_SECONDS:-10} * 1000 )) && [[ -S $_CAPRI_SOCK ]] || return 0

  local json="{\"type\":\"cmd.done\",\"cmd\":$(_capri_json "$cmd"),\"code\":$code,\"ms\":$ms"
  json+=",\"cwd\":$(_capri_json "$PWD"),\"pid\":$$"
  json+=",\"kitty_window\":$(_capri_json "${KITTY_WINDOW_ID:-}"),\"kitty_listen\":$(_capri_json "${KITTY_LISTEN_ON:-}")}"
  ( zsocket "$_CAPRI_SOCK" 2>/dev/null || exit 0; print -r -- "$json" >&$REPLY ) &!
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _capri_preexec
precmd_functions=(_capri_precmd ${precmd_functions:#_capri_precmd})
