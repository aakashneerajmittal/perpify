export const ORDERfORM = {
  maxWidth: "310px",
  minWidth: "250px",
  height: "100%",
  // flex column so the field area flexes and the Buy/Sell submit button is always pinned within
  // the viewport. The TierCard is a variable-height addition; the old fixed calc() offset didn't
  // account for it, so the panel overflowed and pushed the submit below the fold — which made
  // trading impossible on standard laptop screens.
  display: "flex",
  flexDirection: "column",
  zIndex: 5,
  borderRadius: "8px",
  backgroundColor: "background.primary",
  position: "relative",
  margin: "auto",
  width: "100%",
  boxShadow: "none"
};
