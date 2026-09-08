#!/usr/bin/env bash
# Verify that a Linux ELF binary has neither a program interpreter nor DT_NEEDED entries.
set -euo pipefail

BINARY="${1:?Usage: verify-static.sh <binary>}"

if [ ! -x "$BINARY" ]; then
    echo "ERROR: binary is missing or not executable: $BINARY" >&2
    exit 1
fi

if ! file "$BINARY" | grep -Eq 'ELF .* (statically linked|static-pie linked)'; then
    echo "ERROR: binary is not reported as statically linked" >&2
    file "$BINARY" >&2
    exit 1
fi

if readelf -l "$BINARY" | grep -q 'INTERP'; then
    echo "ERROR: binary contains an ELF program interpreter" >&2
    exit 1
fi

if readelf -d "$BINARY" 2>/dev/null | grep -q 'NEEDED'; then
    echo "ERROR: binary contains dynamic library dependencies" >&2
    exit 1
fi

echo "Static ELF verification passed: $BINARY"
