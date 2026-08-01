// PERPIFY brand palette — the investment-thesis / deck design system.
// Dark, minimal: warm off-white on near-black, a single blue accent, and
// green/red reserved for BUY/SELL. All legacy DENSITY_* export names are kept
// so the rest of the app keeps compiling; only the VALUES are rebranded.
//
//   bg   #080808 / #0F0F0F / #151515      text  #F0EDE8 / #888880 / #55554F
//   blue #4F8EFF (accent)                 green #3ECF8E   red #FF5555

export const DENSITY_MAIN = {
  main: "#4F8EFF", // Perpify blue accent
  tint4: "#26436F" // deep blue tint
};

// Greyscale ramp. Keys preserved for compatibility; values remapped to the
// Perpify near-black system. Per the original inverted dark-mode convention,
// "black"/"white" here mean FOREGROUND (warm off-white text).
export const NeutralDark = {
  black: "#F0EDE8", // foreground text (warm off-white)
  white: "#F0EDE8", // foreground text (warm off-white)
  grey1: "#080808", // app background (darkest)
  grey2: "#0F0F0F", // primary panel
  grey3: "#151515", // secondary / elevated panel
  grey4: "#1E1E1E", // tertiary surface
  grey5: "#2A2A2A", // strong hairline
  grey6: "#888880", // muted text (text-2)
  grey7: "#6E6E68", // dim text
  grey8: "#A8A8A0", // bright secondary text
  grey9: "#CFCCC6", // near-foreground
  green2: "#4F8EFF", // (was yellow-green highlight) → blue accent
  grey10: "#55554F" // deep muted (text-3)
};

export const DENSITY_BACKGROUND = {
  primary: NeutralDark.grey2, // #0F0F0F — primary panel
  secondary: NeutralDark.grey3, // #151515 — elevated panel
  tertiary: NeutralDark.grey4, // #1E1E1E — tertiary surface
  default: NeutralDark.grey1 // #080808 — app background
};

export const DENSITY_TEXT = {
  default: NeutralDark.white, // warm off-white (primary text)
  main: "#4F8EFF", // accent
  primary: NeutralDark.grey6, // muted text (#888880)
  secondary: NeutralDark.grey10, // deep muted (#55554F)
  tertiary: NeutralDark.grey7, // dim text
  quaternary: NeutralDark.grey8, // bright secondary text
  highlight: "#4F8EFF", // accent (was yellow-green)
  light: NeutralDark.grey1, // dark (text on light surfaces)
  warning: "#EBB62F"
};

export const SUCCESS = {
  primary: "#3ECF8E", // Perpify green
  secondary: "#0E3D2C" // deep green tint (dark-theme surface behind green)
};

export const ERROR = {
  primary: "#FF5555", // Perpify red
  secondary: "#3D1414", // deep red tint
  default: "#FF5555"
};
