TEAM 3 RETROSPECTIVE SPRINT 2
=====================================

The retrospective should include _at least_ the following
sections:

- [process measures](#process-measures)
- [quality measures](#quality-measures)
- [general assessment](#assessment)

## PROCESS MEASURES 

### Macro statistics

- Number of stories committed vs done : 9 stories committed, 9 stories done
- Total points committed vs done : 18 points committed, 18 points done
- Nr of hours planned vs spent (as a team) : 99h 55m planned, 96h 10m spent

**Remember**  a story is done ONLY if it fits the Definition of Done:
 
- Unit Tests passing
- Code review completed
- Code present on VCS
- End-to-End tests performed
- Integration tests passing

### Detailed statistics

| Story  | # Tasks | Points | Hours est. | Hours actual |
|--------|---------|--------|------------|--------------|
| _#0_   |   11    |    -   |  28h 15m   |   28h 50m    |
| US-07 |    4    |    3   |   5h       |    6h 40m    |
| US-08   |    6    |    1   |   3h 45m   |    3h 25m    |
| US-09   |    7    |    2   |  10h 25m   |   10h 55m    |
| US-10  |    6    |    2   |   8h 30m   |    9h 5m     |
| US-20  |    7    |    3   |  10h 45m   |    9h 15m    |
| US-11  |    6    |    1   |   8h 30m   |    7h        |
| US-21  |    6    |    2   |   8h 45m   |    7h 15m    |
| US-22  |    6    |    2   |   8h 15m   |    8h 15m    |
| US-12  |    6    |    2   |   7h 45m   |    5h 30m    |

- Hours per task  <span style="color:red">per person</span>  (average, standard deviation): average 1.11h, standard deviation 0.65h
- Total task estimation error ratio: sum of total hours estimation / sum of total hours spent -1 = 99.92 / 96.17 - 1 = 0.039

  
## QUALITY MEASURES 

- Unit Testing:
  - Total hours estimated: 10h 40m
  - Total hours spent: 9h 15m
  - Nr of automated unit test cases: 694 (433 backend + 261 frontend)
  - Coverage (if available): 86.33% statements, 81.56% branches, 80.51% functions, 88.46% lines
- Integration testing:
  - Total hours estimated: 11h 15m
  - Total hours spent: 9h 40m
- E2E testing:
  - Total hours estimated: 12h 30m
  - Total hours spent: 11h 30m
- Code review: 
  - Total hours estimated: 10h
  - Total hours spent: 11h 15m

  


## ASSESSMENT

- What caused your errors in estimation (if any)?

  The overall error is small, but code review was underestimated: in particular the review of MH-7, one of the two stories carried over from sprint 1, took more than twice the estimated time. Some fixes (MH-101, MH-104) also took longer than expected and three tasks not foreseen at sprint planning were added during the sprint (MH-153 backend refactoring, MH-154 frontend fixes, MH-155 test fixes), while testing tasks were slightly overestimated, so the errors balanced out.

- What lessons did you learn (both positive and negative) in this sprint?

  Positive:
  - We noticed that the slack from sligthly overestimated tasks absorbed the unexpected additional work, such as fixing tests or making frontend adjustments, without significantly affecting the sprint schedule
  - We realized that assigning tasks based on team members' availability helps maintain a continuous workflow. By planning around known commitments, we can distribute tasks more effectively and avoid long periods of inactivity or unnecessary delays

  Negative:
  - We realized that implementing new user stories can introduce regressions in existing functionality or cause previously passing tests to fail. Therefore, we should always allocate some time during sprint planning for potential fixes and regression-related tasks


- Which improvement goals set in the previous retrospective were you able to achieve? 
  - Estimating tasks better in order to be more precise with the sprint planning: the estimation error stayed below 5% and all the committed stories were completed
  
- Which ones you were not able to achieve? Why?
  N/A

- Improvement goals for the next sprint and how to achieve them (technical tasks, team coordination, etc.)
  - Reserve some time in story #0 for unforeseen fixes and refactoring, so that they do not affect the committed stories

- One thing you are proud of as a Team!!
  - We completed all the committed stories, including the two left unfinished in the previous sprint, with an estimation error below 5% and a workload evenly shared among all of us.
