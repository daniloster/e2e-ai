# Pocket Notes — app guide for the e2e tool

Pocket Notes is a small notes app (web and iOS/Android): people sign in, then add, tick off and
delete short notes. Each note has a title and an optional description.

## Screens

- **Sign in**: title "Sign in to your notes", fields **Email** and **Password**, button **Sign in**.
  A wrong password shows "Wrong email or password.".
- **My notes**: heading "My notes", "Signed in as <email>", a **New note** field with an **Add note**
  button, the list of notes (each row: a done checkbox with the title, the description under it,
  and a **Delete** (×) button), and **Sign out**. An empty list shows "No notes yet. Add your first one.".
- **Consent sheet** (mobile, over any screen until answered): title "Help us improve Pocket Notes",
  asks to allow anonymous usage statistics and crash reports (Firebase Analytics and Crashlytics),
  buttons **No thanks** (do not allow) and **Allow**.

## Routes

| Route         | Web                                  | Mobile                   | Description                                        |
| ------------- | ------------------------------------ | ------------------------ | -------------------------------------------------- |
| signin        | /app.html#/signin                    | signin                   | the sign in screen                                 |
| notes         | /app.html#/notes                     | notes                    | the signed-in user's notes                         |
| notes-session | /app.html?session={token}#/notes     | notes?session={token}    | open the notes already signed in, with a login token |

`{token}` is filled from the last `token` the API returned (`POST /auth/login`).

## Before every scenario

- POST /__test/reset

## Glossary

- **signed in as X**: log in through the API (`POST /auth/login` with X's email and password), then
  open `notes-session` — do not use the sign in screen.
- **sign in / log in (When)**: use the sign in screen: fill Email and Password, tap Sign in.
- **a note**: a row in the notes list showing its title.
- **add a note**: type the title into the New note field, then tap Add note.
- **delete / remove a note**: tap the Delete button of that note.
- **via API**: create data with the test-data endpoints, never through the screens.

## Examples

- Given there is an account "bo@example.org" with password "hunter2" → call POST /__test/users
- Given "bo@example.org" owns a note "Water plants" → call POST /__test/notes
- Given I am signed in as "bo@example.org" → call POST /auth/login; open notes-session
- When I log in with "bo@example.org" and "hunter2" → fill Email field = "bo@example.org"; fill Password field = "hunter2"; tap Sign in button
- When I remove the note "Water plants" → tap Delete button of note = "Water plants"
- Then there should be 3 notes → expect count notes in the list = 3
- Then I should not see "Water plants" → expect hidden note = "Water plants"
- Then I should see the message "Saved" → expect visible message = "Saved"
