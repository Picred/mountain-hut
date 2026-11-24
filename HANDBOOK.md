## GitHub management:

- `main`: protected, create pull request from QA only when a story is DONE

- `dev`: from this create branches for the user stories, when story ready to be tested merge into QA (wait for previous to be OUT of testing phase)

- `user_story_n`: created from dev, use for development, when story is ready to be tested (and previous MUST be already in QA) merge into dev

- `QA`: from dev (story implemented, ready to be tested), from this create branches for different kind of tests

EACH TIME YOU MERGE A USER STORY, A DEVELOPMENT OR TESTING BRANCH: DELETE IT!

EACH TIME YOU DO A MERGE OR PULL REQUEST UPDATE ON WHATSAPP WITH FIXED MESSAGE!

messages for commit: build, fix, doc, test, refactor, ... + (USER STORY NUMBER) 

## README:

Update Readme in dev, remember to update api documentation in dedicated file

## Database:
To create and populate databse:
`npm run db:init`
To reset the database (delete, recreate and repopulate):
`npm run db:reset`

## Docker:
docker compose pull
docker compose up -d
docker compose exec backend npm run db:reset
docker compose down -v
docker stop mountain-hut-frontend mountain-hut-backend