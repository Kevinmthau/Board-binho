# Flick Soccer

Build a fully offline, two-person Board Sports game with physical defenders and
finger flicks. Keep the existing app and package IDs so installed copies update
in place.

## Decisions

The mode is COMPETITIVE. Shots alternate between two human players. Four Sports
Pieces defend each half. The standard match ends at three goals. House Rules
offer one, three, five, or seven goals.

Pieces are set before the opening shot, then remain fixed as blockers for the
entire match, including goals and pauses. Players leave them untouched and take
turns swiping the ball toward the opposite goal from wherever it stops. Browser
placement and dragging are available only before the first shot.

The visual direction is sports, racing, and arcade. The font shortlist from
the approved catalog was Fugaz One, Racing Sans One, and Bungee. Fugaz One was
selected for its italic sports lettering. Its shipped metadata uses the family
name Board Game Font because the original reserves its name.

The home screen and title card use separate compositions from the same
canvas artwork. The home reserves space for PLAY and HOW TO PLAY. Real Sports
renders appear in help, practice, and browser play.

The standard screen flow, OS player picker, remembered house rules, animated
help, swipe-only practice, results, Board menu, and table flip are
implemented. A tutorial is remembered for the selected set of profile IDs.
Guests and AI IDs do not enter the key. This release supports human players.

Source stays in the existing public Kevinmthau/Board-binho repository, as
explicitly requested by the owner for this release. This overrides the
standards' private Harris-Hill hosting requirement.

## Verification

The browser suite covers the normal menu flow, native Board input, canceled
contacts, pause and resume, tracker recovery, physics, tutorial retries and
profile groups, house rules, results, fixed blockers, setup orientation touch
gating, and flipped input.
An offline test serves the production files from disk with the browser network
disabled, then plays through a goal to the results screen.

Every package is checked before it replaces the previous ZIP. The scan includes
all files, UTF-16 strings, compressed PNG metadata, and decoded WOFF2 fonts.
Source links are kept in repository documentation.

The standards pass uses revision f00b6e018eb5ebf9569fc2c59e5a62f3325e00d6 of
[board-game-standards](https://github.com/Harris-Hill/board-game-standards/blob/f00b6e018eb5ebf9569fc2c59e5a62f3325e00d6/BOARD_GAME_DESIGN_STANDARDS.md).

## Remaining checks

Check feel and sustained frame rate with two people and real Pieces on a Board.
Campaign saves and AI difficulty levels apply when those modes are introduced.

## Development and release

Use `cd web && npm run dev` for browser play. Set the blockers before the first
shot, then take turns swiping the ball. Use the browser Match menu for pause
and help.

Use `./scripts/release_webapp.sh` for a new versioned release. It renders the
current 1536 × 864 title card, runs the tests, builds and checks the package,
and creates a new release folder. Increase the package version for the next
release. Use `./scripts/build_webapp.sh --install` for a Board installation.
