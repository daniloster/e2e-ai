#auth #team-atlas
Feature: Signing in
  People sign in with their email and password to reach their notes.

  Background:
    Given a user "ana@example.com" with password "s3cret!" exists

  #smoke
  Scenario: Signing in with the right password shows my notes
    When I open the sign in screen
    And I sign in as "ana@example.com" with password "s3cret!"
    Then I should see "My notes"
    And I should see "Signed in as ana@example.com"

  #security
  Scenario: A wrong password is rejected
    When I open the sign in screen
    And I sign in as "ana@example.com" with password "not-it"
    Then I should see "Wrong email or password."
    And I should not see "My notes"

  Scenario: Signing out returns to the sign in screen
    Given I am signed in as "ana@example.com"
    When I sign out
    Then I should see "Sign in to your notes"
