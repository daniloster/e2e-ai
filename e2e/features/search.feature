#search #team-atlas
Feature: Searching notes
  People find a note by typing part of its title or its description.

  Background:
    @routine create user "ana@example.com" with password "s3cret!" and notes:
      | title            | description       |
      | Buy milk         | Semi-skimmed      |
      | Call the plumber | Kitchen tap leaks |
      | Pay rent         | Due on the first  |

  #smoke
  Scenario: Only matching notes are listed
    Given I am signed in as "ana@example.com"
    When I search my notes for "milk"
    Then I should see "Buy milk"
    And I should not see "Pay rent"
    And I should see 1 note in the list

  Scenario: Search ignores upper and lower case
    Given I am signed in as "ana@example.com"
    When I search my notes for "PLUMBER"
    Then I should see "Call the plumber"
    And I should see 1 note in the list

  Scenario: Descriptions are searched too
    Given I am signed in as "ana@example.com"
    When I search my notes for "first"
    Then I should see "Pay rent"
    And I should see 1 note in the list

  Scenario: A search with no match says so
    Given I am signed in as "ana@example.com"
    When I search my notes for "taxes"
    Then I should see "No notes match your search."
    And I should not see "Buy milk"

  Scenario: Clearing the search lists every note again
    Given I am signed in as "ana@example.com"
    When I search my notes for "milk"
    And I clear the search
    Then I should see 3 notes in the list
