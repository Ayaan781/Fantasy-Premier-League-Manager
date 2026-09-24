#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
download_tmp="$script_dir/.fpl-bootstrap.tmp"
fixtures_tmp="$script_dir/.fpl-fixtures.tmp"
generated_tmp="$script_dir/.fpl-players.tmp"
trap 'rm -f "$download_tmp" "$fixtures_tmp" "$generated_tmp"' EXIT HUP INT TERM

curl --fail --location --silent --show-error --max-time 35 \
  --retry 3 --retry-delay 1 --retry-connrefused \
  'https://fantasy.premierleague.com/api/bootstrap-static/' \
  --output "$download_tmp"

curl --fail --location --silent --show-error --max-time 35 \
  --retry 3 --retry-delay 1 --retry-connrefused \
  'https://fantasy.premierleague.com/api/fixtures/' \
  --output "$fixtures_tmp"

if ! jq -e '
  (.elements | type == "array" and length > 0)
  and (.teams | type == "array" and length > 0)
  and (.events | type == "array" and length > 0)
  and ((.game_settings.squad_total_spend | type) == "number")
  and ((.game_settings.squad_total_spend // 0) > 0)
  and ((.game_settings.ui_currency_multiplier // 0) > 0)
  and ((.game_settings.squad_team_limit // 0) > 0)
' "$download_tmp" >/dev/null; then
  echo 'The official player feed is incomplete; keeping the saved snapshot.' >&2
  exit 1
fi

if ! jq -e 'type == "array" and length > 0' "$fixtures_tmp" >/dev/null; then
  echo 'The official fixture feed is incomplete; keeping the saved snapshot.' >&2
  exit 1
fi

date_stamp=$(date -u +%F)
year_num=$(date -u +%Y)
month_num=$(date -u +%m)
if [ "$month_num" -ge 7 ]; then
  season_label="$year_num/$((year_num + 1))"
else
  season_label="$((year_num - 1))/$year_num"
fi

jq -er --arg updated "$date_stamp" --arg season "$season_label" --slurpfile fixtures "$fixtures_tmp" '
  "window.FPL_DATA = " + ({
    source: "https://fantasy.premierleague.com/api/bootstrap-static/",
    updated: $updated,
    season: $season,
    gameweek: ([.events[] | select(.is_current == true) | .name][0] // null),
    nextEvent: ([.events[] | select(.is_next == true) | .id][0] // null),
    budget: (.game_settings.squad_total_spend / .game_settings.ui_currency_multiplier),
    teamLimit: .game_settings.squad_team_limit,
    positions: {"1":"GKP","2":"DEF","3":"MID","4":"FWD"},
    teams: [.teams[] | {id:.id, name:.name, short:.short_name, form:(.form | tonumber? // null)}],
    fixtures: ($fixtures[0] | [.[] | select(.event != null and .finished == false) | {
      event:.event,
      kickoff:.kickoff_time,
      home:.team_h,
      away:.team_a,
      homeDifficulty:.team_h_difficulty,
      awayDifficulty:.team_a_difficulty
    }]),
    players: [.elements[] | {
      id:.id,
      name:.web_name,
      team:.team,
      position:.element_type,
      price:.now_cost,
      totalPoints:.total_points,
      form:(.form | tonumber?),
      pointsPerGame:(.points_per_game | tonumber?),
      expectedNext:(.ep_next | tonumber?),
      minutes:.minutes,
      starts:.starts,
      goals:.goals_scored,
      assists:.assists,
      cleanSheets:.clean_sheets,
      bonus:.bonus,
      bps:.bps,
      expectedGoals:(.expected_goals | tonumber?),
      expectedAssists:(.expected_assists | tonumber?),
      expectedGoalInvolvements:(.expected_goal_involvements | tonumber?),
      selectedBy:(.selected_by_percent | tonumber?),
      status:.status,
      chanceNext:.chance_of_playing_next_round,
      news:.news
    }]
  } | tojson) + ";"
' "$download_tmp" > "$generated_tmp"

mv "$generated_tmp" "$script_dir/players.js"
printf 'Refreshed the official FPL player pool (%s players, %s).\n' \
  "$(jq '.elements | length' "$download_tmp")" "$date_stamp"
