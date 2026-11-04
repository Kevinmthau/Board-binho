# Flick Soccer assets

All runtime assets are stored inside the game. The build excludes this document.

| Asset | Source and changes | Shipped notice |
| --- | --- | --- |
| Game name font | Fugaz One 400, approved for sports, racing, and arcade. Metadata web addresses removed and renamed Board Game Font. | public/fonts/OFL.txt |
| Home art and title card | Original canvas compositions in web/src/pitch-art.ts. The title card is separately rendered for each release. | Project artwork |
| Sports Pieces 1–7 | Canonical individual renders from board-game-standards/piece-renders/sports, resized with empty margins cropped. | Board-provided artwork |
| Sports Piece 8 | Basketball player extracted from the canonical original Sports lineup. | Board-provided artwork |
| Flip button | Standard 72 × 72 icon from board-game-standards/icons/flip-button.png. | Board-provided artwork |
| piece.ogg | Kenney Impact Sounds, impactwood_light_000.ogg. Optional web address removed from the Vorbis comment. | public/sfx/License.txt |
| flick.ogg | Kenney Impact Sounds, impactgeneric_light_000.ogg. Optional web address removed from the Vorbis comment. | public/sfx/License.txt |
| crowd-cheer.mp3 | Crowd Cheer 5 by Krizin, Freesound 651646. Existing trimmed and normalized excerpt. | public/assets/crowd-cheer-LICENSE.txt |
| Matter.js | 0.20.0. Optional homepage omitted from its license comment during bundling. The complete MIT copyright and permission text remain. | In bundled JavaScript |
| poly-decomp | 0.3.0. | public/licenses/poly-decomp-MIT.txt |
| Touch model | Board Sports v0.1.0, SHA-256 4d75343e149b72f8410cad10f518c64791634ae6e6932880088a34c164026ad9. | Board SDK distribution |

The approved font catalog and canonical artwork are in
[board-game-standards](https://github.com/Harris-Hill/board-game-standards).
The font is available from [Google Fonts](https://fonts.google.com/specimen/Fugaz+One).

The short effects come from
[Board's shared sound library](https://github.com/Harris-Hill/board-sound-library/tree/main/sounds/kenney/impact-sounds).
The original Vorbis comment identifies GameSynth by Tsugi as the authoring tool.

The goal audio is
[Crowd Cheer 5](https://freesound.org/people/Krizin/sounds/651646/), under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The physics library's homepage is [Matter.js](https://brm.io/matter-js/).
