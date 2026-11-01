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

```json
{
  "slotId": 1,
  "partySize": 3
}
```

- **Response:** `201 Created`

```json
{
  "reservationId": 9,
  "slotId": 1,
  "partySize": 3,
  "status": "confirmed",
  "tableAllocation": [
    {
      "tableId": 2,
      "allocatedSeats": 3
    }
  ]
}
```

- **Errors:**
  - `400 Bad Request` — `INVALID_INPUT`
  - `401 Unauthorized` — `UNAUTHORIZED`
  - `404 Not Found` — `SLOT_NOT_FOUND`
  - `409 Conflict` — `BOOKING_TOO_LATE`
  - `409 Conflict` — `NO_AVAILABILITY`
  - `409 Conflict` — `ALREADY_BOOKED`

