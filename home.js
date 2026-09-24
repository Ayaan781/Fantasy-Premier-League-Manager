(() => {
  const feed = window.FPL_DATA;
  if (!feed) return;
  document.querySelectorAll("[data-player-pool]").forEach((node) => {
    node.textContent = feed.players.length.toLocaleString();
  });
  document.querySelectorAll("[data-updated]").forEach((node) => {
    const date = new Date(`${feed.updated}T12:00:00Z`);
    node.textContent = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  });
})();
