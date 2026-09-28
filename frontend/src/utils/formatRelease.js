// Full release date for a card's top-left tag ("Sep 17, 2026"), used by the
// New Releases and Upcoming rows in place of the year.
export const formatRelease = (item) =>
  item.released
    ? new Date(item.released).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
