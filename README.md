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

