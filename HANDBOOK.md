## GitHub management:
main: protected, create pull request from Q&A only when a story is DONE
dev: from this create branches for the user stories, when story ready to be tested merge into Q&A (wait for previous to be OUT of testing phase)
user_story_n: created from dev, from this create branch for development, when story is ready to be tested (and previous MUST be already in Q&A) merge into dev
features: created from user_story_n, when feature is ready merge into user_story_n
Q&A: from dev (story implemented, ready to be tested, ADD README!!!), from this create branches for different kind of tests

EACH TIME YOU MERGE A USER STORY, A DEVELOPMENT OR TESTING BRANCH: DELETE IT!

EACH TIME YOU DO A MERGE OR PULL REQUEST UPDATE ON WHATSAPP WITH FIXED MESSAGE!

messages for commit: build, fix, doc, test, refactor, ... + (USER STORY NUMBER) 

## README:
To update the readme (APIs, changes in db, ...) use the following Google Doc:
[temporary README]https://docs.google.com/document/d/13gvaBs71VofaLxOHZIONJAvJICQNX7yykZIsvPofW8g/edit?usp=sharing
Finally before merging the dev into the Q&A copy the part related to the specific user story in the README of dev
