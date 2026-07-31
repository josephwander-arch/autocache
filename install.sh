#!/bin/sh
# Autocache installer (POSIX sh) - macOS, Linux, WSL, Git Bash on Windows.
#
# Detects which AI surfaces are present on this machine, installs into each,
# and prints a per-surface result table.
#
#   - idempotent: running it twice changes nothing the second time
#   - it never overwrites existing state under ~/.autocache
#   - it exits non-zero only on a genuine failure
#
# Usage:  ./install.sh [--dry-run] [--link] [--uninstall] [--quiet] [--help]

set -u

VERSION="0.1.0"
DRY_RUN=0
LINK=0
UNINSTALL=0
QUIET=0
FAILURES=0
ROWS=""

usage() {
  cat <<'EOF'
Autocache installer

Usage: ./install.sh [options]

  --dry-run    print the plan, write nothing
  --link       symlink hooks and skills instead of copying (developer mode)
  --uninstall  remove what was installed; state under ~/.autocache is kept
  --quiet      only print the result table
  --help       this text

Environment:
  AUTOCACHE_HOME     state root (default ~/.autocache) - never overwritten
  CODEX_HOME         Codex home (default ~/.codex)
  AUTOCACHE_GROK_DIR if set, Grok skill markdown is copied here
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --link) LINK=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --quiet|-q) QUIET=1 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'unknown option: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

say() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

add_row() {
  # surface | detected | result | detail
  _row=$(printf '  %-12s %-10s %-12s %s' "$1" "$2" "$3" "$4")
  if [ -z "$ROWS" ]; then ROWS="$_row"; else ROWS="$ROWS
$_row"; fi
  case "$3" in FAILED) FAILURES=$((FAILURES + 1)) ;; esac
}

# ---------------------------------------------------------------- locations

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT="$SCRIPT_DIR"
STATE_ROOT="${AUTOCACHE_HOME:-$HOME/.autocache}"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
CLAUDE_DIR="$HOME/.claude"

say "Autocache installer v$VERSION"
[ "$DRY_RUN" -eq 1 ] && say "  DRY RUN - nothing will be written"
say "  repository : $REPO_ROOT"
say "  state root : $STATE_ROOT (shared by every surface, never overwritten)"
say ""

# ---------------------------------------------------------------- preflight

if ! command -v node >/dev/null 2>&1; then
  printf 'FAILED: node is required and was not found on PATH.\n' >&2
  printf 'Autocache hooks run under plain node with zero npm dependencies.\n' >&2
  printf 'Install Node.js (https://nodejs.org) and run this again.\n' >&2
  exit 1
fi
NODE_VERSION=$(node --version 2>/dev/null || echo unknown)
say "  node       : $NODE_VERSION"

if [ ! -d "$REPO_ROOT/hooks" ] && [ "$UNINSTALL" -eq 0 ]; then
  printf 'FAILED: %s/hooks not found - this does not look like an Autocache checkout.\n' "$REPO_ROOT" >&2
  exit 1
fi

# The state root is created empty if absent. Existing state is never touched.
if [ -d "$STATE_ROOT" ]; then
  say "  state      : existing state found, left untouched"
elif [ "$UNINSTALL" -eq 1 ] || [ "$DRY_RUN" -eq 1 ]; then
  say "  state      : would create $STATE_ROOT"
else
  mkdir -p "$STATE_ROOT" 2>/dev/null && say "  state      : created $STATE_ROOT"
fi
say ""

NODE_FLAGS=""
[ "$DRY_RUN" -eq 1 ] && NODE_FLAGS="$NODE_FLAGS --dry-run"
[ "$LINK" -eq 1 ] && NODE_FLAGS="$NODE_FLAGS --link"
[ "$UNINSTALL" -eq 1 ] && NODE_FLAGS="$NODE_FLAGS --uninstall"

# ------------------------------------------------------------- Claude Code

if [ -d "$CLAUDE_DIR" ] || command -v claude >/dev/null 2>&1; then
  if [ -f "$REPO_ROOT/.claude-plugin/plugin.json" ]; then
    if [ "$UNINSTALL" -eq 1 ]; then
      add_row "claude-code" "yes" "manual" "run: /plugin uninstall autocache"
      say "Claude Code: remove the plugin from inside Claude Code:"
      say "    /plugin uninstall autocache"
    else
      add_row "claude-code" "yes" "manual" "one command, inside Claude Code"
      say "Claude Code: Autocache is a plugin, so Claude Code installs it itself."
      say "  Run this inside Claude Code, from any session:"
      say "    /plugin marketplace add $REPO_ROOT"
      say "    /plugin install autocache"
      say "  (or /plugin marketplace add josephwander-arch/autocache to take it from GitHub)"
      say "  This installer deliberately does not hand-edit the Claude Code plugin"
      say "  directory - the harness owns it, and writing it behind its back is how"
      say "  plugin installs get corrupted."
    fi
  else
    add_row "claude-code" "yes" "skipped" "no .claude-plugin/plugin.json in checkout"
  fi
else
  add_row "claude-code" "no" "skipped" "no ~/.claude and no claude on PATH"
fi
say ""

# -------------------------------------------------------------------- Codex

if [ -d "$CODEX_DIR" ] || command -v codex >/dev/null 2>&1; then
  if [ -f "$REPO_ROOT/adapters/codex/install.js" ]; then
    say "Codex: materializing skills, hooks and rules into $CODEX_DIR"
    CODEX_LOG=$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/autocache-codex-$$.log")
    # shellcheck disable=SC2086
    node "$REPO_ROOT/adapters/codex/install.js" \
      --codex-home="$CODEX_DIR" --repo="$REPO_ROOT" $NODE_FLAGS > "$CODEX_LOG" 2>&1
    CODEX_RC=$?
    [ "$QUIET" -eq 1 ] || grep -v '^AUTOCACHE_RESULT ' "$CODEX_LOG"
    CODEX_CHANGED=$(sed -n 's/^AUTOCACHE_RESULT changed=\([0-9][0-9]*\) .*/\1/p' "$CODEX_LOG" | tail -1)
    rm -f "$CODEX_LOG"
    if [ "$CODEX_RC" -ne 0 ]; then
      add_row "codex" "yes" "FAILED" "see the codex adapter output above"
    elif [ "$UNINSTALL" -eq 1 ]; then
      add_row "codex" "yes" "removed" "$CODEX_DIR (state kept)"
    elif [ "$DRY_RUN" -eq 1 ]; then
      add_row "codex" "yes" "planned" "$CODEX_DIR"
    elif [ "${CODEX_CHANGED:-1}" = "0" ]; then
      add_row "codex" "yes" "unchanged" "$CODEX_DIR (already current)"
    else
      add_row "codex" "yes" "installed" "$CODEX_DIR - restart Codex"
    fi
  else
    add_row "codex" "yes" "FAILED" "adapters/codex/install.js is missing"
  fi
else
  add_row "codex" "no" "skipped" "no $CODEX_DIR and no codex on PATH"
fi
say ""

# --------------------------------------------------------------------- Grok

GROK_SRC="$REPO_ROOT/adapters/grok"
GROK_DEST="${AUTOCACHE_GROK_DIR:-}"
if [ -z "$GROK_DEST" ] && [ -d "$HOME/.grok/skills" ]; then
  GROK_DEST="$HOME/.grok/skills"
fi

if [ ! -d "$GROK_SRC" ]; then
  add_row "grok" "n/a" "skipped" "adapters/grok is missing"
elif [ -n "$GROK_DEST" ]; then
  grok_changed=0
  grok_failed=0
  for skill_dir in "$GROK_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    name=$(basename "$skill_dir")
    src="$skill_dir/SKILL.md"
    [ -f "$src" ] || continue
    dest="$GROK_DEST/$name/SKILL.md"
    if [ "$UNINSTALL" -eq 1 ]; then
      if [ -e "$dest" ]; then
        [ "$DRY_RUN" -eq 1 ] || rm -rf "$GROK_DEST/$name" || grok_failed=1
        grok_changed=$((grok_changed + 1))
        say "  removed  $GROK_DEST/$name"
      fi
    elif cmp -s "$src" "$dest" 2>/dev/null; then
      say "  unchanged $dest"
    else
      if [ "$DRY_RUN" -eq 1 ]; then
        say "  would write $dest"
      else
        mkdir -p "$GROK_DEST/$name" 2>/dev/null || grok_failed=1
        cp "$src" "$dest.tmp" 2>/dev/null && mv "$dest.tmp" "$dest" 2>/dev/null || grok_failed=1
        say "  wrote    $dest"
      fi
      grok_changed=$((grok_changed + 1))
    fi
  done
  if [ "$grok_failed" -eq 1 ]; then
    add_row "grok" "yes" "FAILED" "could not write into $GROK_DEST"
  elif [ "$UNINSTALL" -eq 1 ]; then
    add_row "grok" "yes" "removed" "$GROK_DEST"
  elif [ "$grok_changed" -eq 0 ]; then
    add_row "grok" "yes" "unchanged" "$GROK_DEST"
  elif [ "$DRY_RUN" -eq 1 ]; then
    add_row "grok" "yes" "planned" "$GROK_DEST (read-only surface)"
  else
    add_row "grok" "yes" "installed" "$GROK_DEST (read-only surface)"
  fi
else
  add_row "grok" "manual" "manual" "paste the markdown - see adapters/grok/README.md"
  say "Grok: nothing to install. Grok is a prompt surface with no local directory."
  say "  Paste the skill bodies from $GROK_SRC into Grok's custom instructions."
  say "  Grok READS ~/.autocache and narrates it. Grok cannot write to it."
  say "  Anything Grok proposes must be executed by you, Claude Code, or Codex."
fi
say ""

# ------------------------------------------------------------------- report

printf 'Autocache - result by surface\n\n'
printf '  %-12s %-10s %-12s %s\n' "SURFACE" "DETECTED" "RESULT" "DETAIL"
printf '  %-12s %-10s %-12s %s\n' "------------" "----------" "------------" "------"
printf '%s\n' "$ROWS"
printf '\n'

if [ "$FAILURES" -gt 0 ]; then
  printf 'FAILED: %s surface(s) did not install cleanly.\n' "$FAILURES"
  exit 1
fi

if [ "$UNINSTALL" -eq 1 ]; then
  printf 'Uninstalled. Your state in %s was kept - sessions, breadcrumbs and\n' "$STATE_ROOT"
  printf 'checkpoints survive removing the front ends. Delete that directory yourself\n'
  printf 'if you want the continuity gone too.\n'
elif [ "$DRY_RUN" -eq 1 ]; then
  printf 'Dry run complete. Nothing was written.\n'
else
  printf 'Done. Start a new session on each surface for the hooks to load.\n'
  printf 'State is local plain JSON in %s - read it, diff it, delete it.\n' "$STATE_ROOT"
fi
exit 0
