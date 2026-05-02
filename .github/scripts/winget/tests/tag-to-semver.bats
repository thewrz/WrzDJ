#!/usr/bin/env bats

setup() {
  SCRIPT="${BATS_TEST_DIRNAME}/../tag-to-semver.sh"
}

@test "v2026.04.08 -> 2026.408.0" {
  run "$SCRIPT" "v2026.04.08"
  [ "$status" -eq 0 ]
  [ "$output" = "2026.408.0" ]
}

@test "v2026.04.08.12 -> 2026.408.12" {
  run "$SCRIPT" "v2026.04.08.12"
  [ "$status" -eq 0 ]
  [ "$output" = "2026.408.12" ]
}

@test "v2026.12.31 -> 2026.1231.0" {
  run "$SCRIPT" "v2026.12.31"
  [ "$status" -eq 0 ]
  [ "$output" = "2026.1231.0" ]
}

@test "v2026.01.01 -> 2026.101.0 (no leading-zero arithmetic break)" {
  run "$SCRIPT" "v2026.01.01"
  [ "$status" -eq 0 ]
  [ "$output" = "2026.101.0" ]
}

@test "v2026.02.08.13 -> 2026.208.13" {
  run "$SCRIPT" "v2026.02.08.13"
  [ "$status" -eq 0 ]
  [ "$output" = "2026.208.13" ]
}

@test "no v prefix accepted" {
  run "$SCRIPT" "2026.04.08"
  [ "$status" -eq 0 ]
  [ "$output" = "2026.408.0" ]
}

@test "rejects malformed input" {
  run "$SCRIPT" "garbage"
  [ "$status" -ne 0 ]
}

@test "rejects empty input" {
  run "$SCRIPT" ""
  [ "$status" -ne 0 ]
}
