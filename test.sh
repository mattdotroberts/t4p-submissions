#!/bin/sh
# Regression test: every route must answer the same with or without a query
# string. This is the bug class that twice took the site down (page and API
# 404ing whenever a ?query was present), so it gets checked on every change.
set -e
cd "$(dirname "$0")"
PORT=3999 node server.js &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 1
B=http://127.0.0.1:3999
check() { # name expected-code url
  code=$(curl -s -o /dev/null -w '%{http_code}' "$3")
  if [ "$code" != "$2" ]; then
    echo "FAIL $1: $3 -> $code (want $2)"; exit 1
  fi
  echo "ok   $1"
}
check page               200 "$B/"
check page-with-query    200 "$B/?admin=happy"
check api-list           200 "$B/api/submissions"
check api-list-query     200 "$B/api/submissions?client=test"
check asset              200 "$B/assets/manrope.woff2"
check asset-query        200 "$B/assets/manrope.woff2?v=1"
check unknown-route      404 "$B/nope"
check unknown-with-query 404 "$B/nope?x=1"

# POST without members (the form no longer collects names)
r=$(curl -s -X POST "$B/api/submissions" -H 'Content-Type: application/json' -H 'X-Sub-Client: testscript1' \
  -d '{"name":"Regression Test","desc":"A tool for finding boycott alternatives","url":"https://example.com","hp":""}')
echo "$r" | grep -q '"ok":true' || { echo "FAIL post-no-members: $r"; exit 1; }
echo "$r" | grep -q 'boycott alternatives' || { echo "FAIL post-no-members: description not stored: $r"; exit 1; }
echo "ok   post-no-members"

# POST without a URL (the link is optional)
r=$(curl -s -X POST "$B/api/submissions" -H 'Content-Type: application/json' -H 'X-Sub-Client: testscript3' \
  -d '{"name":"No Link Test","desc":"Offline project","hp":""}')
echo "$r" | grep -q '"ok":true' || { echo "FAIL post-no-url: $r"; exit 1; }
echo "$r" | grep -q '"url"' && { echo "FAIL post-no-url: url should be absent: $r"; exit 1; }
echo "ok   post-no-url"

# POST with a members array must still be accepted (older clients / old data)
r=$(curl -s -X POST "$B/api/submissions" -H 'Content-Type: application/json' -H 'X-Sub-Client: testscript2' \
  -d '{"name":"Legacy Test","members":["A","B"],"url":"https://example.org","hp":""}')
echo "$r" | grep -q '"ok":true' || { echo "FAIL post-with-members: $r"; exit 1; }
echo "ok   post-with-members"

echo "all routes pass"
