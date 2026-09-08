#!/usr/bin/env bash
# Fail if anything in the tree matches a rule in denylist.txt.
#
# Exported to the public repo as scripts/scrub-check.sh and run there by CI, so
# a leak reintroduced by a later hand-edit fails the public build rather than
# waiting for the next export. Same script, same rules file, both sides.
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
denylist="$here/denylist.txt"
root="$PWD"
mode=fail

usage() {
  cat >&2 <<'EOF'
usage: scrub-check.sh [--denylist FILE] [--root DIR] [--count | --stdin]

  --denylist FILE  rules file (default: denylist.txt beside this script)
  --root DIR       tree to scan (default: the current directory)
  --count          print "rule<TAB>hits" for every rule and exit 0; the
                   pre-scrub census the export audit records, which needs the
                   counts of a tree that is expected to be dirty
  --stdin          scan standard input as one stream instead of a tree, for a
                   `git log -p` of a repository whose HEAD is clean but whose
                   HISTORY is not. !skip is by PATH and so cannot apply here:
                   the caller excludes those paths itself (export.sh passes
                   git pathspecs). !allow still applies.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --denylist) denylist="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    --count) mode=count; shift ;;
    --stdin) mode=stdin; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "scrub-check: unknown argument $1" >&2; usage; exit 2 ;;
  esac
done

[ -f "$denylist" ] || { echo "scrub-check: no denylist at $denylist" >&2; exit 2; }
[ -d "$root" ] || { echo "scrub-check: no such directory $root" >&2; exit 2; }

# grep -P is the only mode with lookaround, which the email rules need to
# exempt the project's own author address without exempting a whole file.
echo | grep -qP '' 2>/dev/null || {
  echo "scrub-check: this grep has no -P (PCRE) support; the rules need it" >&2
  exit 2
}

rule_names=()
rule_res=()
skips=()
allows=()
while IFS= read -r line; do
  case "$line" in
    '' | '#'*) continue ;;
    '!skip '*) skips+=("${line#!skip }") ;;
    '!allow '*) allows+=("${line#!allow }") ;;
    *)
      name="${line%%	*}"
      re="${line#*	}"
      [ "$name" != "$re" ] || { echo "scrub-check: rule line is not TAB-separated: $line" >&2; exit 2; }
      rule_names+=("$name")
      rule_res+=("$re")
      ;;
  esac
done <"$denylist"
[ ${#rule_names[@]} -gt 0 ] || { echo "scrub-check: $denylist defines no rules" >&2; exit 2; }

if [ "$mode" = stdin ]; then
  stream="$(mktemp "${TMPDIR:-/tmp}/scrub-stream.XXXXXX")"
  trap 'rm -f "$stream"' EXIT
  cat >"$stream"
fi

cd "$root"

# Tracked files when the root IS a repository root, every file otherwise: an
# export is scanned before `git init` and the public repo after, and a build
# output directory inside a repository has no tracked files at all -- taking
# git's answer there would scan nothing and call it clean.
files=()
if [ "$mode" = stdin ]; then
  files=("$stream")
elif [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ]; then
  while IFS= read -r -d '' f; do files+=("$f"); done < <(git ls-files -z)
else
  while IFS= read -r -d '' f; do files+=("${f#./}"); done < <(
    find . -type f \
      -not -path './.git/*' -not -path '*/node_modules/*' \
      -not -path '*/target/*' -not -path '*/dist/*' -print0
  )
fi

# !skip paths, dropped once for every rule rather than per rule. A stream has
# no paths, so nothing is dropped from it.
scan=()
for f in "${files[@]}"; do
  if [ "$mode" = stdin ]; then scan+=("$f"); continue; fi
  skipped=
  for g in "${skips[@]:-}"; do
    [ -n "$g" ] || continue
    # shellcheck disable=SC2053  # glob match is the point
    if [[ $f == $g ]]; then skipped=1; break; fi
  done
  [ -n "$skipped" ] || scan+=("$f")
done
[ ${#scan[@]} -gt 0 ] || { echo "scrub-check: nothing to scan under $root" >&2; exit 2; }

allowed() {
  for a in "${allows[@]:-}"; do
    [ -n "$a" ] || continue
    printf '%s' "$1" | grep -qP -- "$a" && return 0
  done
  return 1
}

total=0
for i in "${!rule_names[@]}"; do
  name="${rule_names[$i]}"
  hits=0
  # -I so a binary file is treated as non-matching; -o so !allow can test the
  # matched text rather than the whole line.
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    rest="${hit#*:}"
    text="${rest#*:}"
    allowed "$text" && continue
    hits=$((hits + 1))
    [ "$mode" = count ] || printf '%s: [%s] %s\n' "${hit%%:*}:${rest%%:*}" "$name" "$text"
  done < <(grep -IHno -P -- "${rule_res[$i]}" "${scan[@]}" || true)
  [ "$mode" != count ] || printf '%s\t%d\n' "$name" "$hits"
  total=$((total + hits))
done

if [ "$mode" = count ]; then
  printf 'TOTAL\t%d\n' "$total"
  exit 0
fi
if [ "$total" -gt 0 ]; then
  where="$root"
  [ "$mode" != stdin ] || where="the input stream"
  echo "scrub-check: FAIL -- $total denylist hit(s) in $where" >&2
  exit 1
fi
if [ "$mode" = stdin ]; then
  echo "scrub-check: clean -- ${#rule_names[@]} rules, 0 hits (stream)"
else
  echo "scrub-check: clean -- ${#scan[@]} files, ${#rule_names[@]} rules, 0 hits"
fi
