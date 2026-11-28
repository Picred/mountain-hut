# mountain-hut APIs

## Authentication - Sessions

### GET `/api/sessions/current`
Gets the info of the user currently logged
- Request body: empty
- Response: `200 OK`
Response body:
```json
{
  "user_id": 6,
  "name": "Mario Rossi",
  "email": "mario@example.com",
  "phone": "3331234567",
  "role": "hiker"
}
```

**ERRORS**
`401 Unauthenticated` - "UNAUTHORIZEDd"

### POST `/api/sessions`
Logs a user into the site (the role depends from the type of account)
- Request body:
```json
{
   "emaild": "mario@example.comd",
  "passwordd": "password123d"
}
```
- Response: `201 Created`
- Response body content: a json with user’s information
```json
{
   "user_idd": 6,
    "named": "Mario Rossid",
    "emaild": "mario@example.comd",
    "phoned": "3331234567d"
}
```

**ERRORS**
`401 Unauthenticated` - "Invalid credentialsd"

### DELETE `/api/sessions/current`
Deletes the active session
- Request body: empty
- Response: `204 No content`
- Response body: empty

- **ERRORS**
`401 Unauthenticated` - "UNAUTHORIZEDd"

## Authentication - Users

### POST `/api/users`
Creates the account of a hiker, given his personal information
Request body:
```json
{
   "named": "Mario Rossid",
    "emaild": "mario@example.comd",
    "phoned": "3331234567d",
    "passwordd": "password123d"
}
```

- Response: `201 Created`
- Response body content: a json with user’s information
```json
{
   "user_idd": 6,
    "named": "Mario Rossid",
    "emaild": "mario@example.comd",
    "phoned": "3331234567d"
}
```

**ERRORS**
`400 Bad request` - "All fields (name, email, phone, password) are required.d" / "The password must contain at least 6 characters."
`409 Conflict` - "Email already in used"


### POST `/api/users/password-reset`
Starts the password recovery: sends an email with a link to choose a new password.

- **Authentication:** not required (public)
- **Request body:** `email` is a non-empty string (leading and trailing spaces are removed).
```json
{
  "email": "mario@example.com"
}
```
- **Response:** `204 No Content`, with an empty body.
If the email belongs to a hiker, an email is sent with the link `<FRONTEND_URL>/reset-password?token=<token>`.
- The link is valid for 24 hours and can be used only once.
- Only the SHA-256 hash of the token is saved: the token itself is only in the email.
- The current password keeps working until the link is used.
- If the email is not registered, nothing is sent. The answer is the same in both cases, so it does not tell whether the email is registered.
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (missing, not a string, or empty `email`)

### POST `/api/users/password-reset/confirm`
Sets the new password using the token of the recovery link (`/reset-password?token=...`).

- **Authentication:** not required (public)
- **Request body:** `token` is the non-empty token of the link, `newPassword` a string of at least 6 characters.
```json
{
  "token": "Zx3hK9...",
  "newPassword": "newPassword123"
}
```
- **Response:** `204 No Content`, with an empty body. The user is not logged in by this call: the hiker has to log in with the new password.
The new password is saved and the token is invalidated, so the link works only once.
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (missing, not a string, or empty `token`)
  - `400 Bad Request` — "The password must contain at least 6 characters."
  - `400 Bad Request` — `INVALID_OR_EXPIRED_TOKEN` (the token does not exist, has already been used, or has expired)

### PUT `/api/users/password`
Changes the password of the logged user. It is used to replace the temporary password received at the first access (`passwordToChange`), and it clears that flag.
- **Authentication:** required.
- **Request body:** `newPassword` is a string of at least 6 characters.
```json
{
  "newPassword": "newPassword123"
}
```
- **Response:** `200 OK` — the updated user, with `passwordToChange` set to `false`. The session is renewed with the updated user.
```json
{
  "user_id": 6,
  "name": "Mario Rossi",
  "email": "mario@example.com",
  "phone": "3331234567",
  "role": "hiker",
  "passwordToChange": false
}
```
- **Errors:**
  - `400 Bad Request` — "The password must contain at least 6 characters." (missing, not a string, or too short)
  - `401 Unauthorized` — `UNAUTHORIZED` (no active session, or the user no longer exists)



## Slots

### GET `/api/slots?date=YYYY-MM-DD`

Retrieves the booking slots for the specified date including just the slots with at least one table.

- **Query parameter:** `date` (required, format: `YYYY-MM-DD`).
- **Response:** `200 OK` — an array of slots containing:
  - `slotId`
  - `startTime`
  - `endTime`
  - `availableSeats` (total seats from assigned tables minus seats allocated to confirmed reservations)
  - `bookingAllowed`
  - `restrictionReason`
- **Errors:**
  - `400 Bad Request` — `INVALID_DATE` (missing or invalid date).

### GET `/api/slots/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD`

Retrieves all the slots ordered by start time.

- **Authentication:** required (role `employee`).
- **Query parameters:** `from` and `to` (both optional and included, format: `YYYY-MM-DD`). They are compared with the slot start date in the mountain hut's local time. For a single day use the same value for both.
- **Response:** `200 OK` — an array of slots containing:
  - `slotId`
  - `startAt`
  - `endAt`
  - `menu` (text, `null` if not defined, see MH-10)
  - `hasTables`
  - `totalSeats`
  - `tables` (an array of `tableId`, `code`, `seats`)

```json
[
  {
    "slotId": 1,
    "startAt": "2026-11-02T11:00:00.000Z",
    "endAt": "2026-11-02T12:00:00.000Z",
    "menu": "**Lunch menu**\n- Polenta\n- Apple strudel",
    "hasTables": true,
    "totalSeats": 8,
    "tables": [
      { "tableId": 1, "code": "T1", "seats": 4 },
      { "tableId": 2, "code": "T2", "seats": 4 }
    ]
  },
  {
    "slotId": 2,
    "startAt": "2026-11-02T12:00:00.000Z",
    "endAt": "2026-11-02T13:00:00.000Z",
    "menu": null,
    "hasTables": false,
    "totalSeats": 0,
    "tables": []
  }
]
```

- **Errors:**
  - `400 Bad Request` — `INVALID_DATE`
  - `400 Bad Request` — `INVALID_DATE_RANGE` (`from` after `to`)
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`

### GET `/api/slots/:slotId/availability?partySize=N`

Checks whether a party fits in the slot (free seats and table layout, at least 2 hours before it starts) and how it would be split over the tables.

- **Authentication:** not required (public).
- **Path parameter:** `slotId` (positive integer), from `GET /api/slots?date=YYYY-MM-DD`.
- **Query parameter:** `partySize` (required, positive integer).
- **Response:** `200 OK`

```json
{
  "slotId": 6,
  "partySize": 6,
  "available": true,
  "tableAllocation": [
    { "tableId": 4, "tableCode": "T4", "allocatedSeats": 2 },
    { "tableId": 5, "tableCode": "T5", "allocatedSeats": 2 },
    { "tableId": 6, "tableCode": "T6", "allocatedSeats": 2 }
  ]
}
```

If the party does not fit, `available` is `false` and `tableAllocation` is empty.

- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (invalid `slotId` or `partySize`)
  - `404 Not Found` — `SLOT_NOT_FOUND`

### GET `/api/slots/:slotId/floor`
 
Retrieves, in a single call, everything needed to draw the floor map of a slot: who is seated at each table and where each reservation is seated.
 
- **Authentication:** required (role `employee`)
- **Path parameter:** `slotId`
- **Response:** `200 OK` — an object containing:
  - `slot` (`slotId`, `startAt`, `endAt`, `menu`)
  - `tables` (all the tables of the slot, ordered by `tableId`), each with:
    - `tableId`, `code`, `seats`
    - `bookedSeats` (seats allocated to confirmed reservations)
    - `remainingSeats` (`seats - bookedSeats`, negative if the table is overbooked)
    - `overbooked` (boolean, `true` if `bookedSeats` is greater than `seats`)
    - `guests` (the reservations seated at the table: `reservationId`, `displayName`, `allocatedSeats`, `hasRequirements`, `hasAllergy`)
  - `reservations` (the `confirmed` and `waiting` reservations of the slot, ordered by `reservationId`; the cancelled ones are not included), each with:
    - `reservationId`
    - `displayName` (the name of the hiker, or the name of the guest if the hiker is not registered)
    - `phone` (`null` if not available)
    - `isGuest` (boolean, `true` for a hiker not registered)
    - `partySize`
    - `status` (`confirmed` or `waiting`)
    - `editable` (boolean, `true` only for `confirmed` reservations)
    - `hasRequirements`, `hasAllergy`
    - `requirements` (an array of `id`, `peopleCount`, `description`, `isAllergy`)
    - `allocation` (the tables where the party is seated: `tableId`, `tableCode`, `seats`)
```json
{
  "slot": {
    "slotId": 2,
    "startAt": "2026-11-29T12:00:00.000Z",
    "endAt": "2026-11-29T13:00:00.000Z",
    "menu": null
  },
  "tables": [
    {
      "tableId": 1,
      "code": "T1",
      "seats": 4,
      "bookedSeats": 4,
      "remainingSeats": 0,
      "overbooked": false,
      "guests": [
        { "reservationId": 4, "displayName": "Edward Coles", "allocatedSeats": 4, "hasRequirements": true, "hasAllergy": false }
      ]
    },
    {
      "tableId": 3,
      "code": "T3",
      "seats": 6,
      "bookedSeats": 5,
      "remainingSeats": 1,
      "overbooked": false,
      "guests": [
        { "reservationId": 5, "displayName": "Anna Winden", "allocatedSeats": 2, "hasRequirements": false, "hasAllergy": false },
        { "reservationId": 6, "displayName": "Bruno Ryn", "allocatedSeats": 3, "hasRequirements": false, "hasAllergy": false }
      ]
    }
  ],
  "reservations": [
    {
      "reservationId": 4,
      "displayName": "Edward Coles",
      "phone": "+393451234567",
      "isGuest": false,
      "partySize": 8,
      "status": "confirmed",
      "editable": true,
      "hasRequirements": true,
      "hasAllergy": false,
      "requirements": [
        { "id": 3, "peopleCount": 1, "description": "lactose free", "isAllergy": false }
      ],
      "allocation": [
        { "tableId": 1, "tableCode": "T1", "seats": 4 },
        { "tableId": 2, "tableCode": "T2", "seats": 4 }
      ]
    }
  ]
}
```
 
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (invalid `slotId`)
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `SLOT_NOT_FOUND`

### GET `/api/slots/menus`

Retrieves the menus already defined (distinct texts), to reuse and change them in another slot.

- **Authentication:** required (role `employee`).
- **Response:** `200 OK` — an array (at most 50) ordered from the most recently used menu, containing:
  - `menu`
  - `lastUsedAt` (start of the latest slot with this menu, ISO 8601, UTC)

```json
[
  {
    "menu": "**Dinner menu**\n- Main course\n  - *Braised beef* with polenta",
    "lastUsedAt": "2026-11-04T18:00:00.000Z"
  }
]
```

- **Errors:**
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`

### POST `/api/slots`

Creates a slot without tables.

- **Authentication:** required (role `employee`).
- **Request body:** `startAt` and `endAt` are ISO 8601 date-times with timezone, they are saved in UTC.

```json
{
  "startAt": "2026-11-02T12:00:00Z",
  "endAt": "2026-11-02T13:00:00Z"
}
```

- **Response:** `201 Created`

```json
{
  "slotId": 2,
  "startAt": "2026-11-02T12:00:00.000Z",
  "endAt": "2026-11-02T13:00:00.000Z",
  "menu": null,
  "hasTables": false,
  "totalSeats": 0,
  "tables": []
}
```

- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `400 Bad Request` — `INVALID_TIME_RANGE` (`endAt` not after `startAt`)
  - `400 Bad Request` — `SLOT_IN_THE_PAST`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `409 Conflict` — `SLOT_OVERLAP`

### POST `/api/slots/:id/tables`

Adds tables of the catalog to a slot.

- **Authentication:** required (role `employee`).
- **Request body:**

```json
{
  "tableIds": [1, 2, 3]
}
```

- **Response:** `201 Created` — the slot with all its tables
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (invalid slot id, or `tableIds` is not a non-empty array of positive integers)
  - `400 Bad Request` — `DUPLICATE_TABLE_CODE` (two selected tables have the same code)
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `SLOT_NOT_FOUND`
  - `404 Not Found` — `TABLE_NOT_FOUND`
  - `409 Conflict` — `SLOT_HAS_RESERVATIONS`
  - `409 Conflict` — `TABLE_CODE_ALREADY_IN_SLOT` (the slot already has a table with the same code, or the same table)

### POST `/api/slots/:id/copy-tables`

Copies the tables of another slot into this slot.

- **Authentication:** required (role `employee`).
- **Request body:**

```json
{
  "fromSlotId": 1
}
```

- **Response:** `201 Created` — the destination slot with all its tables
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `400 Bad Request` — `SAME_SLOT`
  - `400 Bad Request` — `NO_TABLES_TO_COPY` (the source slot has no tables)
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `SLOT_NOT_FOUND` (destination)
  - `404 Not Found` — `SOURCE_SLOT_NOT_FOUND`
  - `409 Conflict` — `SLOT_HAS_RESERVATIONS`
  - `409 Conflict` — `TABLE_CODE_ALREADY_IN_SLOT`

### PUT `/api/slots/:slotId/menu`

Sets (or replaces) the menu of a slot that has not started yet. Changing a reused menu only affects this slot.

- **Authentication:** required (role `employee`).
- **Request body:** `menu` is a non-empty text of at most 2000 characters (leading and trailing spaces are removed).

```json
{
  "menu": "**Lunch menu**\n- First course\n  - *Polenta concia*\n- Apple strudel"
}
```

- **Response:** `200 OK`

```json
{
  "slotId": 1,
  "menu": "**Lunch menu**\n- First course\n  - *Polenta concia*\n- Apple strudel"
}
```

- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `400 Bad Request` — `SLOT_IN_THE_PAST` (the slot has already started)
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `SLOT_NOT_FOUND`

### PUT `/api/slots/:slotId/allocations`
 
Rearranges people across the tables of a slot (e.g. to make room after a cancellation). All the changes are applied in a single transaction: either all of them or none. The capacity of the tables is checked only at the end, so a party can take the seats that another party frees in the same request.
 
- **Authentication:** required (role `employee`)
- **Path parameter:** `slotId`
- **Request body:** `reservations` is a non-empty array (at most 200 elements) with the final seating of each reservation to move. The reservations that are not listed stay where they are. Each element has:
  - `reservationId` (positive integer, not repeated)
  - `tables` (non-empty array of `tableId` and `seats`, with positive integers and no repeated `tableId`). The sum of `seats` must be equal to the `partySize` of the reservation, and the tables must be tables of the slot
```json
{
  "reservations": [
    {
      "reservationId": 4,
      "tables": [
        { "tableId": 1, "seats": 2 },
        { "tableId": 2, "seats": 4 },
        { "tableId": 3, "seats": 2 }
      ]
    },
    {
      "reservationId": 5,
      "tables": [
        { "tableId": 1, "seats": 2 }
      ]
    }
  ]
}
```
 
- **Response:** `200 OK` — an object containing:
  - `slotId`
  - `changedReservationIds` (the reservations whose seating actually changed; the others are left untouched)
  - `overbookedTables` (the tables with more people than seats after the change: `tableId`, `code`, `seats`, `occupiedSeats`; empty if none)
  - `floor` (the updated floor of the slot, same content of `GET /api/slots/:slotId/floor`, so no other call is needed)
```json
{
  "slotId": 2,
  "changedReservationIds": [4, 5],
  "overbookedTables": [],
  "floor": { "slot": { }, "tables": [ ], "reservations": [ ] }
}
```
 
An email with the updated details (including the tables) is sent to each registered hiker whose reservation changed. Guests have no email: nothing is sent.
 
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (invalid `slotId`, `reservations` empty, too long or malformed, repeated `reservationId`, invalid or repeated `tableId`, invalid `seats`)
  - `400 Bad Request` — `TABLE_NOT_IN_SLOT` (a table does not belong to the slot)
  - `400 Bad Request` — `ALLOCATION_MISMATCH` (the seats do not sum to the `partySize` of the reservation)
  - `400 Bad Request` — `RESERVATION_NOT_IN_SLOT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `SLOT_NOT_FOUND`
  - `404 Not Found` — `RESERVATION_NOT_FOUND`
  - `409 Conflict` — `SLOT_ALREADY_ENDED`
  - `409 Conflict` — `RESERVATION_NOT_EDITABLE` (the reservation is not `confirmed`)
  - `409 Conflict` — `TABLE_OVERBOOKED` (a table would have more people than seats; only if overbooking is not allowed, to be confirmed)

### DELETE `/api/slots/:slotId/menu`

Removes the menu of a slot that has not started yet.

- **Authentication:** required (role `employee`).
- **Response:** `204 No Content`
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `400 Bad Request` — `SLOT_IN_THE_PAST`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `SLOT_NOT_FOUND`


## Reservations

### GET `/api/reservations`

Retrieves all the reservations of the authenticated user, to choose the one to change.

- **Authentication:** required.
- **Response:** `200 OK` — an array ordered from the latest time slot, empty if the user has no reservations. It contains all the reservations, also the cancelled ones (they have no tables): use `status` to choose which ones to show. Each element contains:
  - `reservationId`
  - `slotId`
  - `startAt` and `endAt` of the slot (ISO 8601, UTC)
  - `partySize`
  - `status` (`confirmed`, `waiting` or `cancelled`)
  - `createdAt` (when the reservation was made)
  - `requirements` (an array of `id`, `peopleCount`, `description`, `isAllergy`). The `id` is used to update or remove the requirement
  - `tableAllocation` (an array of `tableId`, `tableCode`, `allocatedSeats`)

```json
[
  {
    "reservationId": 9,
    "slotId": 1,
    "startAt": "2026-11-04T11:00:00.000Z",
    "endAt": "2026-11-04T12:00:00.000Z",
    "partySize": 4,
    "status": "confirmed",
    "createdAt": "2026-11-03T10:15:00.000Z",
    "requirements": [
      { "id": 12, "peopleCount": 1, "description": "1 vegan, peanut allergy", "isAllergy": true },
      { "id": 13, "peopleCount": 2, "description": "2 vegetarians", "isAllergy": false }
    ],
    "tableAllocation": [
      { "tableId": 2, "tableCode": "T2", "allocatedSeats": 4 }
    ]
  }
]
```

- **Errors:**
  - `401 Unauthorized` — `UNAUTHORIZED`

### GET `/api/reservations/:reservationId`
 
Retrieves the full detail of a reservation (also of a guest, or a cancelled one).
 
- **Authentication:** required (role `employee`)
- **Path parameter:** `reservationId`
- **Response:** `200 OK` — an object containing:
  - `reservationId`, `slotId`
  - `startAt` and `endAt` of the slot (ISO 8601, UTC)
  - `partySize`
  - `status` (`confirmed`, `waiting` or `cancelled`)
  - `createdAt`
  - `createdBy` (`userId`, `name`: who made the reservation, the hiker or an employee)
  - `hiker` (`userId`, `isGuest`, `name`, `email`, `phone`, `notes`, `emergencyContact`). For a guest `userId` is `null`, `isGuest` is `true`, and `email`, `notes` and `emergencyContact` are `null`
  - `requirements` (an array of `id`, `peopleCount`, `description`, `isAllergy`)
  - `tableAllocation` (an array of `tableId`, `tableCode`, `allocatedSeats`; empty if the reservation is cancelled)
```json
{
  "reservationId": 4,
  "slotId": 2,
  "startAt": "2026-11-29T12:00:00.000Z",
  "endAt": "2026-11-29T13:00:00.000Z",
  "partySize": 8,
  "status": "confirmed",
  "createdAt": "2026-11-28T06:00:00.000Z",
  "createdBy": { "userId": 5, "name": "Edward Coles" },
  "hiker": {
    "userId": 5,
    "isGuest": false,
    "name": "Edward Coles",
    "email": "edward@mountainhut.test",
    "phone": "+393451234567",
    "notes": null,
    "emergencyContact": null
  },
  "requirements": [
    { "id": 3, "peopleCount": 1, "description": "lactose free", "isAllergy": false }
  ],
  "tableAllocation": [
    { "tableId": 1, "tableCode": "T1", "allocatedSeats": 4 },
    { "tableId": 2, "tableCode": "T2", "allocatedSeats": 4 }
  ]
}
```
 
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `RESERVATION_NOT_FOUND`

### POST `/api/reservations` (hiker)

Creates a confirmed reservation for the authenticated user.

- **Authentication:** required.

- **Request body:**

`requirements` is optional. If provided, each entry must include a positive integer `peopleCount`, a non-empty `description`, and a boolean `isAllergy`. The sum of all `peopleCount` values must not exceed `partySize`.

```json
{
  "slotId": 1,
  "partySize": 3,
  "requirements": [
    {
      "peopleCount": 1,
      "description": "peanut allergy",
      "isAllergy": true
    },
    {
      "peopleCount": 2,
      "description": "vegetarian",
      "isAllergy": false
    }
  ]
}
```

- **Response:** `201 Created`

When `requirements` is included in the request, it is included in the response:

```json

{
  "reservationId": 9,
  "slotId": 1,
  "partySize": 3,
  "status": "confirmed",
  "requirements": [
    {
      "peopleCount": 1,
      "description": "peanut allergy",
      "isAllergy": true
    },
    {
      "peopleCount": 2,
      "description": "vegetarian",
      "isAllergy": false
    }
  ],
  "tableAllocation": [
    {
      "tableId": 2,
      "tableCode": "B1",
      "allocatedSeats": 3
    }
  ]
}

```

If `requirements` is omitted, the response does not include that field.

- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `404 Not Found` — `SLOT_NOT_FOUND`
  - `409 Conflict` — `BOOKING_TOO_LATE`
  - `409 Conflict` — `NO_AVAILABILITY`
  - `409 Conflict` — `ALREADY_BOOKED`

### POST `/api/reservations` (employee)
 
The same endpoint described above for the hiker, with a different behavior when the authenticated user is an employee: the employee books on behalf of a hiker.
 
- **Authentication:** required (role `employee`).
- **Differences from the hiker:**
  - the field `hiker` is required and says who the reservation is for (the employee cannot book for themselves);
  - the employee can book until the slot starts, the hiker until 2 hours before;
  - the reservation is saved with the employee as `created_by`.
- **Request body:** `slotId`, `partySize` and `requirements` follow the same rules of the hiker. `hiker` is an object in one of these three forms:
  - **registered hiker:** `userId` (positive integer, the user must have the role `hiker`)
  - **new hiker:** `name`, `email`, `phone` (non-empty strings) and optional `emergency_contact` and `notes` (strings). The hiker is registered in the same transaction of the reservation, with a random password that must be changed at the first login. If the reservation fails, the account is not created.
  - **guest (temporary hiker):** `name` (non-empty string) and optional `phone` (string). The guest has no account and cannot log in.
  The form is chosen by the fields: `userId` first, then `email`, otherwise the guest.
Registered hiker:
 
```json
{
  "slotId": 1,
  "partySize": 3,
  "requirements": [
    { "peopleCount": 1, "description": "peanut allergy", "isAllergy": true }
  ],
  "hiker": { "userId": 3 }
}
```
 
New hiker:
 
```json
{
  "slotId": 1,
  "partySize": 2,
  "hiker": {
    "name": "Mario Rossi",
    "email": "mario@example.com",
    "phone": "3331234567",
    "emergency_contact": "Luisa Rossi (wife), +39 333 7654321",
    "notes": "Registered mountain guide"
  }
}
```
 
Guest:
 
```json
{
  "slotId": 1,
  "partySize": 2,
  "hiker": { "name": "Mark Rossi", "phone": "0123456789" }
}
```
 
- **Response:** `201 Created` — the reservation, as for the hiker, plus:
  - `hiker` (`userId`, `name`, `email`, `phone`). For a guest `userId` and `email` are `null`, and `phone` is `null` if not given
  - `temporaryPassword` (only when a new hiker is registered). It is shown only in this response: the employee has to give it to the hiker, who is forced to change it at the first access (see `PUT /api/users/password`)
```json
{
  "reservationId": 10,
  "slotId": 1,
  "partySize": 2,
  "status": "confirmed",
  "hiker": {
    "userId": 9,
    "name": "Mario Rossi",
    "email": "mario@example.com",
    "phone": "3331234567"
  },
  "tableAllocation": [
    { "tableId": 4, "tableCode": "T4", "allocatedSeats": 2 }
  ],
  "temporaryPassword": "q3F8xT1pZ0aB"
}
```
 
A confirmation email is sent to the registered hiker (also to a new one, but the email does not contain the temporary password). Guests have no email: nothing is sent.
 
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (`hiker` missing or not an object, invalid `userId`, missing `name`, `email` or `phone` for a new hiker, missing `name` for a guest, plus the errors of the hiker)
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `404 Not Found` — `SLOT_NOT_FOUND`
  - `404 Not Found` — `HIKER_NOT_FOUND` (`userId` does not exist or is not a hiker)
  - `409 Conflict` — `BOOKING_TOO_LATE` (the slot has already started)
  - `409 Conflict` — `NO_AVAILABILITY`
  - `409 Conflict` — `ALREADY_BOOKED` (the registered hiker already has a `confirmed` or `waiting` reservation for the slot)
  - `409 Conflict` — `EMAIL_ALREADY_USED` (new hiker with an email already registered)

### PATCH `/api/reservations/:reservationId` (hiker)

Modifies an existing reservation owned by the authenticated user. Changing the slot or party size recalculates the table allocation atomically. If the new party does not fit, nothing is changed and the reservation keeps its slot, its party size and its tables. Changes are admitted until 48 hours before the start of the booked slot, otherwise `EDIT_WINDOW_EXPIRED`.

- **Authentication:** required.
- **Path parameter:** `reservationId` (positive integer).
- **Request body:** at least one field must be provided. The `requirements` object and each of its operations (`add`, `update`, `remove`) are optional. After the change the party size cannot be reduced under the number of people with requirements unless the requirements are reduced in the same request.

```json
{
  "slotId": 7,
  "partySize": 3,
  "requirements": {
    "add": [
      {
        "peopleCount": 1,
        "description": "nut allergy",
        "isAllergy": true
      }
    ],
    "update": [
      {
        "id": 12,
        "peopleCount": 2,
        "description": "vegetarian",
        "isAllergy": false
      }
    ],
    "remove": [13]
  }
}
```

- **Response:** `200 OK` — containing the complete updated reservation:

```json
{
  "reservationId": 9,
  "slotId": 7,
  "partySize": 3,
  "status": "confirmed",
  "requirements": [
    {
      "id": 12,
      "peopleCount": 2,
      "description": "vegetarian",
      "isAllergy": false
    }
  ],
  "tableAllocation": [
    {
      "tableId": 1,
      "tableCode": "T1",
      "allocatedSeats": 3
    }
  ]
}
```

- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `404 Not Found` — `RESERVATION_NOT_FOUND`
  - `404 Not Found` — `SLOT_NOT_FOUND`
  - `404 Not Found` — `REQUIREMENT_NOT_FOUND`
  - `409 Conflict` — `RESERVATION_NOT_EDITABLE`
  - `409 Conflict` — `EDIT_WINDOW_EXPIRED`
  - `409 Conflict` — `BOOKING_TOO_LATE`
  - `409 Conflict` — `NO_AVAILABILITY`
  - `409 Conflict` — `ALREADY_BOOKED`

### PATCH `/api/reservations/:reservationId` (employee)
 
The same endpoint described above for the hiker, with a different behavior when the authenticated user is an employee. The employee can modify any `confirmed` reservation (also of a guest), until the end of the slot (to be confirmed), to manage last minute issues: add or remove people, change dietary requirements or allergies, choose the tables.
 
- **Authentication:** required (role `employee`).
- **Differences from the hiker:**
  - no ownership check and no 48 hours limit;
  - `slotId` cannot be changed (`SLOT_CHANGE_NOT_ALLOWED`, to be confirmed);
  - the optional `allocation` field is accepted;
  - the response is the full detail of the reservation (same as `GET /api/reservations/:reservationId`) plus `overbookedTables`.
- **Request body:** at least one of `partySize`, `requirements`, `allocation`.
  - `partySize` (positive integer)
  - `requirements` (`add`, `update`, `remove`, same format and rules of the hiker). The people with requirements cannot exceed the new `partySize`.
  - `allocation` (optional): the final seating of the whole party, an array of `tableId` and `seats`. The sum of `seats` must be equal to the new `partySize`, and the tables must belong to the slot.
- **Tables when `allocation` is not given:**
  - `partySize` increased: the new people take, in order, the free seats of the tables where the party is already seated, then the free seats of the other tables (`NO_AVAILABILITY` if there are not enough). To seat them somewhere else, or to exceed the seats of a table, use `allocation`.
  - `partySize` decreased: the seats are removed automatically only if the party is seated at a single table, otherwise `allocation` is required (`ALLOCATION_REQUIRED`).
  - `partySize` unchanged: the tables do not change.
- **All the changes are atomic:** if something fails, nothing is changed.
```json
{
  "partySize": 9,
  "requirements": {
    "add": [
      { "peopleCount": 1, "description": "celiac", "isAllergy": true }
    ],
    "remove": [3]
  },
  "allocation": [
    { "tableId": 1, "seats": 4 },
    { "tableId": 2, "seats": 4 },
    { "tableId": 3, "seats": 1 }
  ]
}
```
 
- **Response:** `200 OK` — the full detail of the reservation, plus `overbookedTables` (the tables of the slot with more people than seats after the change, `tableId`, `code`, `seats`, `occupiedSeats`; empty if none):
```json
{
  "reservationId": 4,
  "slotId": 2,
  "startAt": "2026-11-29T12:00:00.000Z",
  "endAt": "2026-11-29T13:00:00.000Z",
  "partySize": 9,
  "status": "confirmed",
  "createdAt": "2026-11-28T06:00:00.000Z",
  "createdBy": { "userId": 5, "name": "Edward Coles" },
  "hiker": {
    "userId": 5,
    "isGuest": false,
    "name": "Edward Coles",
    "email": "edward@mountainhut.test",
    "phone": "+393451234567",
    "notes": null,
    "emergencyContact": null
  },
  "requirements": [
    { "id": 14, "peopleCount": 1, "description": "celiac", "isAllergy": true }
  ],
  "tableAllocation": [
    { "tableId": 1, "tableCode": "T1", "allocatedSeats": 4 },
    { "tableId": 2, "tableCode": "T2", "allocatedSeats": 4 },
    { "tableId": 3, "tableCode": "T3", "allocatedSeats": 1 }
  ],
  "overbookedTables": []
}
```
 
An email with the updated details (including the tables) is sent to the registered hiker. Guests have no email: nothing is sent.
 
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT` (no field, invalid values, `allocation` sent by a non-employee, requirements covering more people than the party)
  - `400 Bad Request` — `SLOT_CHANGE_NOT_ALLOWED` (`slotId` sent by an employee)
  - `400 Bad Request` — `ALLOCATION_REQUIRED` (party reduced and seated at more than one table, without `allocation`)
  - `400 Bad Request` — `ALLOCATION_MISMATCH` (the seats of `allocation` do not sum to the new `partySize`)
  - `400 Bad Request` — `TABLE_NOT_IN_SLOT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `404 Not Found` — `RESERVATION_NOT_FOUND`
  - `404 Not Found` — `REQUIREMENT_NOT_FOUND`
  - `409 Conflict` — `RESERVATION_NOT_EDITABLE` (the reservation is not `confirmed`)
  - `409 Conflict` — `SLOT_ALREADY_ENDED`
  - `409 Conflict` — `NO_AVAILABILITY` (not enough free seats for the new people, when `allocation` is not given)
  - `409 Conflict` — `TABLE_OVERBOOKED` (only if overbooking is not allowed, to be confirmed)

### DELETE `/api/reservations/:reservationId`
 
Cancels a reservation and releases its tables. The reservation is kept with status `cancelled`. A hiker can cancel only their own reservation; an employee can cancel any `confirmed` reservation (also of a guest) until the end of the slot (to be confirmed). A cancellation email is sent to the registered hiker.
 
- **Authentication:** required.
- **Path parameter:** `reservationId`
- **Response:** `200 OK`
```json
{
  "reservationId": 9,
  "status": "cancelled"
}
```
 
- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN` (a hiker cancelling a reservation that is not theirs)
  - `404 Not Found` — `RESERVATION_NOT_FOUND`
  - `409 Conflict` — `RESERVATION_NOT_CANCELLABLE` (hiker: the reservation is already cancelled)
  - `409 Conflict` — `RESERVATION_NOT_EDITABLE` (employee: the reservation is not `confirmed`)
  - `409 Conflict` — `SLOT_ALREADY_ENDED` (employee)

## Tables

### GET `/api/tables`

Retrieves the catalog of table types.

- **Authentication:** required (role `employee`).
- **Response:** `200 OK` — an array of tables ordered by code and seats, containing:
  - `tableId`
  - `code`
  - `seats`
- **Errors:**
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`

### POST `/api/tables`

Adds a new table type to the catalog.

- **Authentication:** required (role `employee`).
- **Request body:** `code` is a non-empty string of at most 20 characters, `seats` an integer between 1 and 100.

```json
{
  "code": "T1",
  "seats": 6
}
```

- **Response:** `201 Created`

```json
{
  "tableId": 8,
  "code": "T1",
  "seats": 6
}
```

- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`
  - `409 Conflict` — `TABLE_ALREADY_EXISTS` (same code and seats already in the catalog)




The menu of a slot is a free text with basic Markdown formatting, stored as it is and rendered by the frontend:
- `**bold**` and `*italic*`
- item lists with `- item`, sub-items indented by two spaces (`  - sub-item`)

The menu is returned in `GET /api/slots/capacity`, it is `null` if not defined. `POST /api/slots/copy-week` copies the menus too when `copyMenu` is `true` (default).


## Hikes

##### GET `/api/hikes/active`

Retrieves all hikers currently registered as being on a hike, including overdue hikes, ordered by expected arrival time ascending. Completed (`returned`) and `cancelled` hikes are excluded.

- **Authentication:** required (role `employee`).
- **Response:** `200 OK` — an array of active hikes ordered by `expectedArrival` ascending (empty if none), each containing:
  - `hikeId`
  - `destination`
  - `route`
  - `passages` (array of intermediate passage point names in route order, empty if none)
  - `scheduledDeparture` (ISO 8601, UTC)
  - `expectedArrival` (ISO 8601, UTC)
  - `partySize`
  - `members` (array of the other people of the party given by the hiker, at most `partySize - 1`, each `{ name, phone }` with `phone` `null` if not given; empty if none was given)
  - `status` (`scheduled`)
  - `createdAt` (ISO 8601, UTC)
  - `isOverdue` (boolean, `true` if `expectedArrival` is in the past)
  - `hiker` (an object containing `userId`, `name`, `email`, `phone`, `notes`, `emergencyContact`; `notes` and `emergencyContact` are `null` if not defined)

```json
[
  {
    "hikeId": 4,
    "destination": "Viso Mozzo",
    "route": "Ridge route, return through the Vallanta valley",
    "passages": [
      "Vallanta pass"
    ],
    "scheduledDeparture": "2026-11-18T08:00:00.000Z",
    "expectedArrival": "2026-11-18T15:00:00.000Z",
    "partySize": 1,
    "members": [],
    "status": "scheduled",
    "createdAt": "2026-11-18T07:45:00.000Z",
    "isOverdue": true,
    "hiker": {
      "userId": 5,
      "name": "Edward Coles",
      "email": "edward@mountainhut.test",
      "phone": "+393451234567",
      "notes": null,
      "emergencyContact": null
    }
  },
]
```
* **Errors:**
* `401 Unauthorized` — `UNAUTHORIZED`
* `401 Forbidden` — `FORBIDDEN` (the authenticated user is not an employee)


### GET `/api/hikes/missing`
Lists the hikers considered missing: hikes still `scheduled` for which at least one alert has been raised. It feeds the pop-up shown to employees and wardens.
Hikers are considered missing after 2 hours has passed from the scheduled arrival time.
Every hour an alert and an email must be sent up until 6 hours after the scheduled arrival time. The alert is independent from the email. If the server goes down only the last alert is sent.
Everything is managed by a background job.

- **Authentication:** required, role `employee` (the warden can use it too).
- **Request body / query:** none.

- **Response:** `200 OK` — array of hikes ordered by expected return time (empty array if nobody is missing). Each element has the same fields as `GET /api/hikes/active`, plus:
  - `alertNumber`: number of the last alert raised for the hike (1 to `totalAlerts`)
  - `lastAlertAt`: ISO date of the last alert
  - `totalAlerts`: total number of alerts (5)
```json
[
  {
    "hikeId": 4,
    "destination": "Viso Mozzo",
    "route": "Ridge route, return through the Vallanta valley",
    "passages": ["Vallanta pass"],
    "scheduledDeparture": "2026-11-24T13:40:47.185Z",
    "expectedArrival": "2026-11-24T20:40:47.185Z",
    "partySize": 1,
    "members": [],
    "status": "scheduled",
    "createdAt": "2026-11-24T22:40:47.515Z",
    "isOverdue": true,
    "hiker": {
      "userId": 5,
      "name": "Edward Coles",
      "email": "edward@mountainhut.test",
      "phone": "+393451234567",
      "notes": null,
      "emergencyContact": null
    },
    "alertNumber": 1,
    "lastAlertAt": "2026-11-24T22:40:47.670Z",
    "totalAlerts": 5
  }
]
```

- **Errors:**
  - `401 Unauthorized` — not logged in
  - `403 Forbidden` — the user is not an employee or a warden


##### POST `/api/hikes`

Registers a planned hike for the authenticated hiker.

- **Authentication:** required (role `hiker`).
- **Request body:** `scheduledDeparture` and `expectedArrival` must be valid ISO 8601 date-times with an explicit timezone. They are normalized to UTC. `partySize` is optional (default `1`, the hiker alone): if given, it must be a positive integer. `passages` is an optional array of non-empty strings, stored in the specified order (default `[]`). `members` lists the other people of the party (the authenticated hiker is the point of contact): it is optional (default `[]`) and can contain some or all of them, at most `partySize - 1` objects `{ name, phone }`, where `name` is a non-empty string and `phone` is optional (a non-empty string or `null`). The scheduled departure must be in the future, and the expected arrival must be after departure.

```json
{
  "destination": "Monte Viso",
  "route": "Pian del Re - Colle delle Traversette - Monte Viso",
  "scheduledDeparture": "2026-11-26T08:00:00Z",
  "expectedArrival": "2026-11-26T17:00:00Z",
  "partySize": 3,
  "passages": [
    "Pian del Re",
    "Colle delle Traversette",
    "Rifugio Quintino Sella"
  ],
  "members": [
    { "name": "Marco Rossi", "phone": "+393331111111" },
    { "name": "Giulia Bianchi" }
  ]
}
```

- **Response:** `201 Created` - the newly registered hike, with its generated ID, the authenticated hiker's ID, normalized dates, and initial status `scheduled`.

```json
{
  "hikeId": 7,
  "userId": 3,
  "destination": "Monte Viso",
  "route": "Pian del Re - Colle delle Traversette - Monte Viso",
  "scheduledDeparture": "2026-11-26T08:00:00.000Z",
  "expectedArrival": "2026-11-26T17:00:00.000Z",
  "partySize": 3,
  "passages": [
    "Pian del Re",
    "Colle delle Traversette",
    "Rifugio Quintino Sella"
  ],
  "members": [
    { "name": "Marco Rossi", "phone": "+393331111111" },
    { "name": "Giulia Bianchi", "phone": null }
  ],
  "status": "scheduled"
}
```

- **Errors:**
  - `400 Bad Request` - `INVALID_INPUT` (missing or invalid fields, non-positive party size, invalid passages, or invalid members).
  - `400 Bad Request` - `PARTY_SIZE_MISMATCH` (more `members` than `partySize - 1`).
  - `400 Bad Request` - `INVALID_DATE` (invalid date-time format or value).
  - `400 Bad Request` - `INVALID_TIME_RANGE` (expected arrival is not after scheduled departure).
  - `400 Bad Request` - `DEPARTURE_IN_THE_PAST` (scheduled departure is in the past).
  - `401 Unauthorized` - `UNAUTHORIZED`.
  - `403 Forbidden` - `FORBIDDEN` (the authenticated user is not a hiker).
  - `409 Conflict` - `HIKE_TIME_CONFLICT` (the hiker already has a `scheduled` hike overlapping the requested time interval).
