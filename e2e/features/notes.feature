#notes #team-atlas
Feature: Keeping notes
  A signed-in person keeps a short list of notes.

  Background:
    Given a user "ana@example.com" with password "s3cret!" exists
    And "ana@example.com" has a note "Buy milk"
    And I am signed in as "ana@example.com"

  #smoke
  Scenario: Seeded notes are listed
    Then I should see "Buy milk"
    And I should see 1 note in the list

  Scenario: Adding a note
    When I add a note "Call the plumber"
    Then I should see "Call the plumber"
    And I should see 2 notes in the list

  #destructive
  Scenario: Deleting a note
    When I delete the note "Buy milk"
    Then I should not see "Buy milk"
    And I should see "No notes yet. Add your first one."

  Scenario Outline: Adding notes with different titles
    When I add a note "<title>"
    Then I should see "<title>"

    Examples:
      | title        |
      | Pay rent     |
      | Book dentist |
