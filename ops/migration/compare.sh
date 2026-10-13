#!/usr/bin/env bash
# Verdict of a rehearsal (ops/migration/rehearse.sh): reads the fingerprints in $OUT, prints
# PASS/FAIL per check and exits 1 on any FAIL.
set -Euo pipefail
: "${OUT:?OUT = rehearsal output directory}" "${MARKED:?MARKED = receipts marked by 0014}"

fails=0
check() { if [[ "$2" == ok ]]; then echo "PASS $1"; else echo "FAIL $1 — $3"; fails=$((fails + 1)); fi; }
val() { awk -F'|' -v k="$2" '$1 == k { print $'"$3"' }' "${OUT}/$1.txt"; }

# Every pre-existing row and value is the same (status of receipts is checked on its own)
d="$(diff <(grep -v '^receipt.status\.' "${OUT}/before.txt") <(grep -v '^receipt.status\.' "${OUT}/after.txt") || true)"
check "old data unchanged by the migration (13 tables, money)" "$([[ -z "$d" ]] && echo ok)" "${d//$'\n'/; }"

# Receipt statuses: approved → paid_out by exactly the number 0014 marked; the total is the same
ab=$(val before receipt.status.approved 2); ab=${ab:-0}; aa=$(val after receipt.status.approved 2); aa=${aa:-0}
pb=$(val before receipt.status.paid_out 2); pb=${pb:-0}; pa=$(val after receipt.status.paid_out 2); pa=${pa:-0}
check "«Выплачен» by 0014: approved −${MARKED}, paid_out +${MARKED}" \
  "$([[ $((ab - aa)) -eq ${MARKED} && $((pa - pb)) -eq ${MARKED} ]] && echo ok)" \
  "approved ${ab}→${aa}, paid_out ${pb}→${pa}, marked ${MARKED}"
tb=$(grep '^receipt.status\.' "${OUT}/before.txt" | awk -F'|' '{s+=$2} END {print s+0}')
ta=$(grep '^receipt.status\.' "${OUT}/after.txt" | awk -F'|' '{s+=$2} END {print s+0}')
check "no receipt lost or added (${tb})" "$([[ ${tb} -eq ${ta} ]] && echo ok)" "${tb} → ${ta}"

# Checks after the migration: every line ends in 0
bad="$(awk -F'|' '$1 !~ /^info_/ && $2 != 0' "${OUT}/invariants.txt")"
check "invariants after the migration ($(grep -vc '^info_' "${OUT}/invariants.txt") checks)" "$([[ -z "$bad" ]] && echo ok)" "${bad//$'\n'/; }"

# Rollback gives back exactly the starting data; a second run gives exactly the same result
d="$(diff "${OUT}/before.txt" "${OUT}/down.txt" || true)"
check "downgrade returns the data exactly as it was" "$([[ -z "$d" ]] && echo ok)" "${d//$'\n'/; }"
d="$(diff "${OUT}/after.txt" "${OUT}/again.txt" || true)"
check "second upgrade gives the same result" "$([[ -z "$d" ]] && echo ok)" "${d//$'\n'/; }"

awk -F'|' '/^info_/ { printf "INFO %s = %s (для сведения, на итог не влияет)\n", substr($1, 6), $2 }' "${OUT}/invariants.txt"

if [[ ${fails} -eq 0 ]]; then echo "REHEARSAL PASS — report: ${OUT}"; else echo "REHEARSAL FAIL (${fails}) — report: ${OUT}"; fi
exit $(( fails > 0 ))
