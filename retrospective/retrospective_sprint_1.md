TEAM 3 RETROSPECTIVE SPRINT 1
=====================================

The retrospective should include _at least_ the following
sections:

- [process measures](#process-measures)
- [quality measures](#quality-measures)
- [general assessment](#assessment)

## PROCESS MEASURES 

### Macro statistics

- Number of stories committed vs done : 8 stories committed, 6 stories done
- Total points committed vs done : 18 points committed, 14 points done
- Nr of hours planned vs spent (as a team) : 97 hours planned, 96h 15m spent

**Remember**  a story is done ONLY if it fits the Definition of Done:
 
- Unit Tests passing
- Code review completed
- Code present on VCS
- End-to-End tests performed
- Integration tests passing


### Detailed statistics

| Story  | # Tasks | Points | Hours est. | Hours actual |
|--------|---------|--------|------------|--------------|
| _#0_   |    9    |    -   | 41h 30m    |    42h 30m   |
| _#1_   |    12   |    3   |  14h 45m   |     16h 35m  |
| _#2_   |    6    |    3   |   8h 30m   |    8h 50m    |
| _#3_   |    3    |    2   |  3h 30m    |    3h 45m    |
| _#4_   |    6    |    2   |   3h 45m   |   4h 5m      |
| _#5_   |    6    |    1   |       3h   |     4h 20m   |
| _#6_   |    6    |    3   |      9h    |    9h 10m    |
| _#7_   |    6    |    3   | 9h 15m     |      6h      |
| _#8_   |    6    |    1   |     3h 45m |      0       |

- Hours per task  <span style="color:red">per person</span>  (average, standard deviation)

|            | Average | StDev |
|------------|------|-------|
| Estimation |1.115 | 2.67  | 
| Actual     |1.106 | 0.787 |

- Total task estimation error ratio: sum of total hours estimation / sum of total hours spent -1

$$\frac{\sum_i spent_{task_i}}{\sum_i estimation_{task_i}} - 1 = 0.0078$$

  
## QUALITY MEASURES 

- Unit Testing:
  - Total hours estimated: 7h
  - Total hours spent: 8h 35m
  - Nr of automated unit test cases: 459
  - Coverage (if available): 86.88 % 
- Integration testing:
  - Total hours estimated: 10h 30m
  - Total hours spent: 9h 5m
- E2E testing:
  - Total hours estimated: 8h
  - Total hours spent: 7h 55m 
- Code review: 
  - Total hours estimated: 6h 30m
  - Total hours spent: 5h 40m

  


## ASSESSMENT

- What caused your errors in estimation (if any)?
  
  We did not manage to finish the last story and half due to some needs arised during the sprint, for example 
  frontend redesign. However the hours estimated ended up being pretty similar to the ones worked.

- What lessons did you learn (both positive and negative) in this sprint?

  Positive:
    - It is really useful to reassign tasks to adapt to each member's time needs
    - The git flow organization with `dev` and `QA` branch is really helpful to organize the work properly

  Negative:
    - We should try to estimate tasks also keeping in mind each team member's pace

- Which improvement goals set in the previous retrospective were you able to achieve? 
  - Git branch management and repo organisation
  - We worked all of our time budget
  - The difference between our estimated hours and our time budget is much lower
  
- Which ones you were not able to achieve? Why?
  N/A

- Improvement goals for the next sprint and how to achieve them (technical tasks, team coordination, etc.)
  - Estimating tasks better in order to be more precise with the sprint planning

- One thing you are proud of as a Team!!
  We were able to overcome all the difficulties of the last sprint and improve our usage of the scrum method, 
  basing our teamwork on communication and flexibility.