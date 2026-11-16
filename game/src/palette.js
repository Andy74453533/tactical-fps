// One palette for the whole game: dusk over a desert relay station. Warm
// sand for the map, amber for Vanguard, teal for Aegis, one hot accent.
export const PALETTE = {
  sky: '#1d2733',
  horizon: '#e8824a',
  fog: '#2a2f3a',
  ground: '#8a6f52',
  groundDark: '#6e583f',
  concrete: '#9a938a',
  concreteDark: '#6f6a63',
  wall: '#b08a5e',
  wallDark: '#8a6a48',
  metal: '#4a5058',
  metalDark: '#33383f',
  containerA: '#b4552d',
  containerB: '#3f6d6a',
  crate: '#a07d4e',
  crateDark: '#7d5f38',
  sandbag: '#7a6a4d',
  accent: '#f0a832',
  vanguard: '#f0a832',
  vanguardDark: '#8a5f1a',
  aegis: '#35c4b5',
  aegisDark: '#1e6e66',
  ink: '#f2ede3',
  muted: '#b8b0a2',
  danger: '#e84a3a',
  charge: '#ffb03a',
  smoke: '#c9c4bb',
};

export const TEAM = {
  VANGUARD: 'vanguard',
  AEGIS: 'aegis',
};

export const TEAM_COLOR = {
  [TEAM.VANGUARD]: PALETTE.vanguard,
  [TEAM.AEGIS]: PALETTE.aegis,
};

export const TEAM_NAME = {
  [TEAM.VANGUARD]: 'Vanguard',
  [TEAM.AEGIS]: 'Aegis',
};
