// Curated list of games shown in the HomePage hero carousel.
//
// Hand-maintained for now: add, remove or reorder RAWG game ids here and the
// hero picks up the change on the next request. Order is preserved in the
// response, and the hero deals them across its rows in this order.
//
// Ids must exist in the `games` table with a non-empty background_image —
// /api/hero drops any that don't, so a bad id degrades to a shorter hero
// rather than a broken tile.
export const HERO_GAME_IDS = [
  3498,   // Grand Theft Auto V
  3328,   // The Witcher 3: Wild Hunt
  4200,   // Portal 2
  28,     // Red Dead Redemption 2
  58175,  // God of War (2018)
  13536,  // Portal
  5679,   // The Elder Scrolls V: Skyrim
  4062,   // BioShock Infinite
  13537,  // Half-Life 2
  5286,   // Tomb Raider (2013)
  416,    // Grand Theft Auto: San Andreas
  278,    // Horizon Zero Dawn
  3439,   // Life is Strange
  2462,   // Uncharted 4: A Thief's End
  58134,  // Marvel's Spider-Man
  4291,   // Counter-Strike: Global Offensive
  2454,   // DOOM (2016)
  3070,   // Fallout 4
  12020,  // Left 4 Dead 2
  1030,   // Limbo
  4286,   // BioShock
  3990,   // The Last of Us
  29177,  // Detroit: Become Human
  802,    // Borderlands 2
  22511,  // The Legend of Zelda: Breath of the Wild
  22509,  // Minecraft
  4459,   // Grand Theft Auto IV
  430,    // Grand Theft Auto: Vice City
  4806,   // Mass Effect 2
  4161,   // Far Cry 3
];
