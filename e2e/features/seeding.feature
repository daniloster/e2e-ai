#seeding #team-atlas
Feature: Data prepared through the API shows in the app
  Data created before the UI is touched must show up after signing in.

  Background:
    @routine create user "bo@example.com" with password "pa55word" and notes: 
      | title       | description            |
      | Eggs        | Chicken Eggs           |
      | Bread       | Wholemeal bread        |
      | Olive oil   | Extra virgin olive oil |


  Scenario: Several notes from a table
    Given I am signed in as "bo@example.com"
    Then I should see 3 notes in the list
    And I should see "Olive oil" as a note

  Background:
    @routine create user with login "ana@example.com" and password "s3cret!"
    @routine create user "bo@example.com" with password "pa55word" and notes: 
      | title       | description            |
      | Bo's secret | Special secret         |


  #security #privacy
  Scenario: Notes of another user stay private
    Given I am signed in as "ana@example.com"
    Then I should see "No notes yet. Add your first one."
    And I should not see "Bo's secret"


  Scenario: user with single note
    Given I am signed in as "bo@example.com"
    Then I should see "Bo's secret" as a note
