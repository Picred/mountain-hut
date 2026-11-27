# Missing hikers: how to choose the time scale (for demo and tests)

## What it is
The variable `MISSING_HIKE_TIME_SCALE` divides the "hour" used by the alerts. With the default (not set, or `1`) the alerts come after 2, 3, 4, 5 and 6 real hours from the expected return time. With `60` one "hour" lasts one minute, so the alerts come after 2, 3, 4, 5 and 6 minutes. The job also checks more often (every 60 s / scale, between 1 s and 60 s).

## When to use it
| Situation | Scale |
|---|---|
| Production, final delivery, any real use | not set (`1`) |
| Live demo (you cannot wait 6 hours) | `60` |
| Automated test that starts the server and waits for the alerts | `60` or more |
| Automated test of the rules | not set: call `processMissingHikes(now)` directly with a simulated `now` (deterministic, no waiting) |
| Manual check of the real times | not set |

Never leave a scale different from 1 in the delivered or deployed application. At startup the server prints a WARNING when the scale is not 1, and the emails say "Demo mode" and show the real delay.

## What changes and what does not
- Changes: the delay of the alerts, how often the job runs, and the email (extra "Demo mode" line).
- Does not change: 5 alerts, the rules, the endpoint `GET /api/hikes/missing`, who receives the emails.
- An invalid value (letters, 0, negative) stops the server at startup with a clear error.

## How to set it (restart the server afterwards)
- `backend/.env`: `MISSING_HIKE_TIME_SCALE=60`
- PowerShell: `$env:MISSING_HIKE_TIME_SCALE=60; node index.js`
- bash: `MISSING_HIKE_TIME_SCALE=60 node index.js`
- Docker: add `MISSING_HIKE_TIME_SCALE: "60"` under `environment` of the backend service.
A variable already present in the environment wins over `.env`. Remove it to go back to real time.

## Demo recipe
1. Reset the database (needed once, it creates the table `hike_alerts`): `npm run db:init -- --reset`.
2. Start the server with the scale, for example 60.
3. Seed hike 4 is already 2 hours late, so with scale 60 it jumps straight to alert 5 of 5 (the server was "off", only the latest alert is raised). For the full sequence 1 to 5, make a hike whose expected return is now, for example from the database:
   `UPDATE hikes SET scheduled_departure = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'), expected_arrival = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE hike_id = 1;`
   With scale 60 the alerts come after about 2, 3, 4, 5 and 6 minutes.
4. To repeat the demo: `DELETE FROM hike_alerts;` and update the expected return again.
5. To stop the alerts, log in as the hiker and call `PUT /api/hikes/:hikeId/confirm-arrival`.

## Notes for the tests
- Starting the server starts the job.
- Clean `hike_alerts` between tests.
- Without SMTP settings (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`) the emails are only printed in the console.
- The alert and the pop-up do not depend on the email.