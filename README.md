# mountain-hut

## Running with Docker

You can run the entire application using only **Docker** and **Docker Compose** by pulling the pre-built images from Docker Hub

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) (with Docker Compose v2+)

### Quick Start

**Clone the repository:**
  
   ```bash
   git clone https://github.com/Picred/mountain-hut.git
   cd mountain-hut
  ```

*(Optional)* **Configure email delivery:** To enable real email sending via SMTP, copy the environment template and fill in your credentials:
```bash
cp backend/.env.template backend/.env
```

*(If skipped, the application will still run normally and print outgoing emails to the backend container logs.)*

**Pull the images from Docker Hub and start the containers:**
```bash
docker compose pull
docker compose up -d
```

### Access the Application

Once the containers are running, open your browser at:

* **Frontend:** http://localhost:5173
* **Backend API:** http://localhost:3001

### Useful Commands

```bash
# View backend logs (e.g., to check simulated emails)
docker compose logs -f backend
```

```bash
# Reset the SQLite database to its initial seed state
docker compose exec backend npm run db:reset
```

```bash
# Stop the application
docker compose down
```

```bash
# Stop the application and remove the database volume (clean reset)
docker compose down -v
```

## License

This project is released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.
The full license text is available in the [LICENSE](./LICENSE) file.

### Why AGPL v3

We chose AGPL v3 because we want this software to stay open for good, even when it is used as an online service. The mountain is already hard enough, managing a hut should be simple and free. The AGPL ensures this software, and every improvement made to it, stays that way.

- **Strong copyleft**: anyone who modifies this code or includes it in another program and distributes it must release the entire derivative work under the same license, with the source code made available.
- **Protection for networked software**: the obligation also applies when the software is offered as a service without being distributed.
- **No proprietary lock-in**: nobody can take the project, improve it, and sell it as a closed product without sharing their changes.
- **Improvements flow back to the community**: enhancements made by third parties remain available to everyone, benefiting the project as a whole.
- **User freedoms guaranteed**: the freedom to use, study, modify, and redistribute the software.
- **Patent protection**: the license includes an express patent grant from contributors.

### What this means in practice

- You can use the app freely, including for commercial purposes.
- You can modify and redistribute it, as long as you keep the same license and provide the source code.
- If you offer a modified version as an online service, you must make the source code available to the users of that service.

## Architecture
- Architecture: client - server
- Backend: Node.js
- Frontend: React
- Database: relational (sqlite)
- Authentication: Passport
- Email: Nodemailer

## Database tables
- `users` contains user_id, name (text), email (text), phone (text), password_hash (text), salt (text), role (text)
- `slots` contains slot_id, start_at (text), end_at (text), menu (text, nullable)
- `tables` contains table_id, table_code (text), seats (number)
- `slot_tables` contains slot_table_id, slot_id, table_id
- `reservations` contains reservation_id, slot_id, user_id, guest_name (text), guest_phone (text), created_by (user_id), party_size (number), status (text), created_at (text)
- `reservation_table` contains reservation_id, slot_table_id, allocated_seats (number)
- `reservation_requirements` contains id, reservation_id, people_count (number), description (text), is_allergy (boolean)
- `hikes` contains hike_id, user_id, destination (text), route (text), scheduled_departure (text), expected_arrival (text), party_size (number), status (text), created_at (text)
- `hike_passages` contains hike_id, position (number), name (text)
- `hike_alerts` containse hike_id, alert_number (number), created_at (text), email_sent_at (text)
- `hike_members` contains hike_id, position (number), name (text), phone (text, nullable): the other people of the party of a hike, some or all of them (at most party_size - 1), the hiker who registered the hike is the point of contact

## Email confirmation format

Recipient: the hiker who made the reservation (email of the user)

Subject: Mountain Hut - Booking confirmation #9

Content (plain text and HTML):
- booking reference: `#` followed by `reservation_id`
- date and time slot
- party size
- party requirements (allergies, diets): None if there are none
- name of the hiker who made the reservation

After a successful `POST /api/reservations`, a confirmation email is sent to the hiker who made the reservation.
After a successful `PATCH /api/reservations/:reservationId`, a confirmation email is sent to the hiker who changed the reservation.
After a successful `DELETE /api/reservations/:reservationId`, a confirmation email is sent to the hiker who cancelled the reservation.
After a successful `PUT /api/users/password`, a recovery password email is sent to the hiker who requested the password recovery.

## APIs

[Documentazione API](API-documentation.md)   