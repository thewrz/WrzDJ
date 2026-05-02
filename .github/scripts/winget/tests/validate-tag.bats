#!/usr/bin/env bats

setup() {
  SCRIPT="${BATS_TEST_DIRNAME}/../validate-tag.sh"
}

@test "accepts v2026.04.08" {
  run "$SCRIPT" "v2026.04.08"
  [ "$status" -eq 0 ]
}

@test "accepts v2026.04.08.2 with revision" {
  run "$SCRIPT" "v2026.04.08.2"
  [ "$status" -eq 0 ]
}

@test "accepts v2026.12.31.99 high revision" {
  run "$SCRIPT" "v2026.12.31.99"
  [ "$status" -eq 0 ]
}

@test "rejects missing v prefix" {
  run "$SCRIPT" "2026.04.08"
  [ "$status" -ne 0 ]
}

@test "rejects rc suffix" {
  run "$SCRIPT" "v2026.04.08-rc1"
  [ "$status" -ne 0 ]
}

@test "rejects 1-digit month" {
  run "$SCRIPT" "v2026.4.08"
  [ "$status" -ne 0 ]
}

@test "rejects 1-digit day" {
  run "$SCRIPT" "v2026.04.8"
  [ "$status" -ne 0 ]
}

@test "rejects 5-digit year" {
  run "$SCRIPT" "v12026.04.08"
  [ "$status" -ne 0 ]
}

@test "rejects empty tag" {
  run "$SCRIPT" ""
  [ "$status" -ne 0 ]
}

@test "rejects no argument" {
  run "$SCRIPT"
  [ "$status" -ne 0 ]
}

@test "rejects trailing dot" {
  run "$SCRIPT" "v2026.04.08."
  [ "$status" -ne 0 ]
}

@test "rejects alpha revision" {
  run "$SCRIPT" "v2026.04.08.a"
  [ "$status" -ne 0 ]
}

@test "stderr names offending tag on reject" {
  run "$SCRIPT" "bad-tag"
  [[ "$output" == *"bad-tag"* ]]
}
