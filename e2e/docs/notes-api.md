# Pocket Notes API

REST + JSON. Base URL comes from `e2e-ai.config.json` (`api.baseUrl`, dev: `http://127.0.0.1:4010`).
Endpoints marked **Auth: bearer** need `Authorization: Bearer <token>`, where the token comes from
`POST /auth/login`.

> How the e2e tool reads this file: every `### METHOD /path` heading is an endpoint the pocket model
> may call; the `Field` table under it is the request body (or query for GET/DELETE); `{id}` in a path
> is a path parameter. A GraphQL operation is written `### MUTATION createNote` / `### QUERY notes`
> and a gRPC method `### RPC notes.v1.Notes/Create`, each with the same `Field` table (see
> `docs/20261118-e2e-ai-cucumber-small-models/`; only REST is executed in the spike).

## Test data (dev/test only)

These routes exist only on the fixture API. Use them to prepare data before the UI is touched.

### POST /__test/reset

Deletes all users, sessions and notes. Runs before every scenario.

### POST /__test/users

Creates a user account that can sign in.

| Field    | Type   | Required | Description                         |
| -------- | ------ | -------- | ----------------------------------- |
| email    | string | yes      | the email address (lower-cased)     |
| password | string | yes      | the password                        |
| name     | string | no       | display name; defaults to the email |

Response `201`: `{ "id": "u1", "email": "ana@example.com", "name": "ana" }`

### POST /__test/notes

Creates a note owned by an existing user, without signing in.

| Field       | Type    | Required | Description                               |
| ----------- | ------- | -------- | ----------------------------------------- |
| ownerEmail  | string  | yes      | email of the user who owns the note       |
| title       | string  | yes      | the note title                            |
| description | string  | no       | longer text shown under the title         |
| done        | boolean | no       | true if the note is already ticked off    |

Response `201`: the note `{ "id": "n2", "title": "Eggs", "description": "", "done": false }`

## Authentication

### POST /auth/login

Signs a user in and returns a session token.

| Field    | Type   | Required | Description        |
| -------- | ------ | -------- | ------------------ |
| email    | string | yes      | the user's email   |
| password | string | yes      | the user's password|

Response `200`: `{ "token": "t-u1-2", "user": { "email": "ana@example.com" } }` · `401` on a wrong password.

### GET /me

The signed-in user. **Auth: bearer**

## Notes

### GET /notes

The signed-in user's notes, oldest first. **Auth: bearer**

### POST /notes

Adds a note for the signed-in user. **Auth: bearer**

| Field       | Type   | Required | Description             |
| ----------- | ------ | -------- | ----------------------- |
| title       | string | yes      | the note title          |
| description | string | no       | text under the title    |

### PATCH /notes/{id}

Changes a note. **Auth: bearer**

| Field | Type    | Required | Description         |
| ----- | ------- | -------- | ------------------- |
| id    | string  | yes      | the note id (path)  |
| title | string  | no       | new title           |
| done  | boolean | no       | ticked off or not   |

### DELETE /notes/{id}

Deletes a note. **Auth: bearer**

| Field | Type   | Required | Description        |
| ----- | ------ | -------- | ------------------ |
| id    | string | yes      | the note id (path) |
