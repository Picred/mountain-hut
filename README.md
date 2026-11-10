# mountain-hut

### Architecture
- Architecture: client - server
- Backend: Node.js
- Frontend: React
- Database: relational (sqlite)
- Authentication: Passport
- Email: Nodemailer

### Database tables
- `users` contains user_id, name (text), email (text), phone (text), password_hash (text), salt (text), role (text)
- `slots` contains slot_id, start_at (text), end_at (text)
- `tables` contains table_id, table_code (text), seats (number)
- `slot_tables` contains slot_table_id, slot_id, table_id
- `dishes` contains dish_id, name (text), description (text), price, course (text)
- `slots_dishes` contains slot_id, dish_id
- `reservations` contains reservation_id, slot_id, user_id, guest_name (text), guest_phone (text), created_by (user_id), party_size (number), status (text), created_at (text)
- `reservation_table` contains reservation_id, slot_table_id, allocated_seats (number)
- `reservation_requirements` contains id, reservation_id, people_count (number), description (text), is_allergy (boolean)

### Email confirmation format

Recipient: the hiker who made the reservation (email of the user)

Subject: Mountain Hut - Booking confirmation #9

Content (plain text and HTML):
- booking reference: `#` followed by `reservation_id`
- date and time slot
- party size
- party requirements (allergies, diets): None if there are none
- name of the hiker who made the reservation

### APIs

#### Authentication

##### POST `/api/users`
Creates the account of a hiker, given his personal information
Request body:
```json
{
   “name”: “Mario Rossi”,
    “email”: “mario@example.com”,
    “phone”: “3331234567”,
    “password”: “password123”
}
```

- Response: `201 Created`
- Response body content: a json with user’s information
```json
{
   “user_id”: 6,
    “name”: “Mario Rossi”,
    “email”: “mario@example.com”,
    “phone”: “3331234567”
}
```



**ERRORS**
`400 Bad request` - “All fields (name, email, phone, password) are required.” / "The password must contain at least 6 characters."
`409 Conflict` - “Email already in use”

##### POST `/api/sessions`
Logs a user into the site (the role depends from the type of account)
- Request body:
```json
{
   “email”: “mario@example.com”,
  “password”: “password123”
}
```
- Response: `201 Created`
- Response body content: a json with user’s information
```json
{
   “user_id”: 6,
    “name”: “Mario Rossi”,
    “email”: “mario@example.com”,
    “phone”: “3331234567”
}
```

**ERRORS**
`401 Unauthenticated` - “Invalid credentials”

##### GET `/api/sessions/current`
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
`401 Unauthenticated` - “UNAUTHORIZED”

##### DELETE `/api/sessions/current`
Deletes the active session
- Request body: empty
- Response: `204 No content`
- Response body: empty

- **ERRORS**
`401 Unauthenticated` - “UNAUTHORIZED”



#### MH-01 - Book a Table

##### GET `/api/slots?date=YYYY-MM-DD`

Retrieves the booking slots for the specified date including just the slots with at least one table.

- **Query parameter:** `date` (required, format: `YYYY-MM-DD`).
- **Response:** `200 OK` — an array of slots containing:
  - `slotId`
  - `startTime`
  - `endTime`
  - `bookingAllowed`
  - `restrictionReason`
- **Errors:**
  - `400 Bad Request` — `INVALID_DATE` (missing or invalid date).

##### POST `/api/reservations`

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



#### MH-02 - Define Slot Capacity

##### GET `/api/slots/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD`

Retrieves all the slots ordered by start time.

- **Authentication:** required (role `employee`).
- **Query parameters:** `from` and `to` (both optional and included, format: `YYYY-MM-DD`). They are compared with the slot start date in the mountain hut's local time. For a single day use the same value for both.
- **Response:** `200 OK` — an array of slots containing:
  - `slotId`
  - `startAt`
  - `endAt`
  - `hasTables`
  - `totalSeats`
  - `tables` (an array of `tableId`, `code`, `seats`)

```json
[
  {
    "slotId": 1,
    "startAt": "2026-11-02T11:00:00.000Z",
    "endAt": "2026-11-02T12:00:00.000Z",
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

##### POST `/api/slots`

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

##### POST `/api/slots/:id/tables`

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

##### POST `/api/slots/:id/copy-tables`

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

##### GET `/api/tables`

Retrieves the catalog of table types.

- **Authentication:** required (role `employee`).
- **Response:** `200 OK` — an array of tables ordered by code and seats, containing:
  - `tableId`
  - `code`
  - `seats`
- **Errors:**
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `403 Forbidden` — `FORBIDDEN`

##### POST `/api/tables`

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



#### MH-03 - Receive Confirmation

No new API: after a successful `POST /api/reservations`, a confirmation email is sent to the hiker who made the reservation.


#### MH-04 - Check Availability

##### GET `/api/slots/:slotId/availability?partySize=N`

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



#### MH-06 - Change a Booking

##### GET `/api/reservations`

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



##### PATCH `/api/reservations/:reservationId`

Modifies an existing reservation owned by the authenticated user. Changing the slot or party size recalculates the table allocation atomically. If the new party does not fit, nothing is changed and the reservation keeps its slot, its party size and its tables.

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
