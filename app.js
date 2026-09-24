(() => {
  "use strict";

  const feed = window.FPL_DATA;
  if (!feed || !Array.isArray(feed.players)) return;

  const FORMATIONS = ["3-4-3", "3-5-2", "4-3-3", "4-4-2", "4-5-1", "5-2-3", "5-3-2", "5-4-1"];
  const POSITION_NAMES = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
  const POSITION_WORDS = { 1: "goalkeeper", 2: "defender", 3: "midfielder", 4: "forward" };
  const STATUS_NAMES = { d: "Doubtful", i: "Injured", s: "Suspended", u: "Unavailable", n: "Not available" };
  const playersById = new Map(feed.players.map((player) => [Number(player.id), player]));
  const teamsById = new Map(feed.teams.map((team) => [Number(team.id), team]));
  const STORAGE_KEY = "fpl-sidekick-squad-v2";
  const LEGACY_STORAGE_KEY = "fpl-sidekick-xi-v1";
  const FORMSPREE_ENDPOINT = "https://formspree.io/f/xvkgrovv";
  const budgetLimit = Number(feed.budget || 100) * 10;
  const teamLimit = Number(feed.teamLimit || 3);

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    formation: $("#formation-select"),
    pitchRows: Object.fromEntries(["GKP", "DEF", "MID", "FWD"].map((position) => [position, $(`[data-row="${position}"]`)])),
    budget: $("#budget-remaining"),
    budgetFill: $("#budget-fill"),
    budgetTrack: $(".budget-track"),
    pickedCount: $("#picked-count"),
    clubCount: $("#club-count"),
    benchGrid: $("#bench-grid"),
    benchComposition: $("#bench-composition"),
    lineupStatus: $("#lineup-status"),
    poolCount: $("#pool-count"),
    activeSlotNote: $("#active-slot-note"),
    search: $("#player-search"),
    filters: $("#position-filters"),
    clubFilter: $("#club-filter"),
    sort: $("#sort-by"),
    resultCount: $("#result-count"),
    playerList: $("#player-list"),
    insights: $("#insights-grid"),
    saveState: $("#save-state"),
    toast: $("#toast"),
    submissionForm: $("#team-submission"),
    submissionStatus: $("#submission-status"),
    report: $("#analysis-report"),
    reportContent: $("#report-content")
  };

  function readSavedState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "null"); }
    catch { return null; }
  }

  const previous = readSavedState();
  const state = {
    formation: FORMATIONS.includes(previous?.formation) ? previous.formation : "4-4-2",
    picks: previous?.picks && typeof previous.picks === "object" ? { ...previous.picks } : {},
    activeSlotId: "GKP-1",
    filterPosition: "1",
    club: "ALL",
    sort: "form",
    query: ""
  };
  elements.formation.value = state.formation;

  const seenPlayerIds = new Set();
  for (const slot of currentSlots()) {
    const playerId = Number(state.picks[slot.id]);
    const player = playersById.get(playerId);
    if (!player || Number(player.position) !== slot.position || seenPlayerIds.has(playerId)) {
      delete state.picks[slot.id];
    } else {
      seenPlayerIds.add(playerId);
    }
  }
  const firstOpenSlot = currentSlots().find((slot) => !state.picks[slot.id]) || currentSlots()[0];
  state.activeSlotId = firstOpenSlot.id;
  state.filterPosition = String(firstOpenSlot.position);

  function currentSlots(formation = state.formation) {
    const [defenders, midfielders, forwards] = formation.split("-").map(Number);
    const starting = [
      { position: 1, count: 1 },
      { position: 2, count: defenders },
      { position: 3, count: midfielders },
      { position: 4, count: forwards }
    ].flatMap(({ position, count }) => Array.from({ length: count }, (_, index) => ({
      id: `${POSITION_NAMES[position]}-${index + 1}`,
      position,
      index: index + 1,
      group: "starting"
    })));
    const benchCounts = { 1: 1, 2: 5 - defenders, 3: 5 - midfielders, 4: 3 - forwards };
    const bench = Object.entries(benchCounts).flatMap(([position, count]) =>
      Array.from({ length: count }, (_, index) => ({
        id: `BENCH-${POSITION_NAMES[position]}-${index + 1}`,
        position: Number(position),
        index: index + 1,
        group: "bench"
      }))
    );
    return [...starting, ...bench];
  }

  function startingSlots(formation = state.formation) {
    return currentSlots(formation).filter((slot) => slot.group === "starting");
  }

  function benchSlots(formation = state.formation) {
    return currentSlots(formation).filter((slot) => slot.group === "bench");
  }

  function reflowPicks(formation) {
    const remainingByPosition = new Map([1, 2, 3, 4].map((position) => [position, []]));
    for (const slot of currentSlots()) {
      const playerId = Number(state.picks[slot.id]);
      if (playerId && playersById.has(playerId)) remainingByPosition.get(slot.position).push(playerId);
    }
    const nextPicks = {};
    for (const slot of currentSlots(formation)) {
      const playerId = remainingByPosition.get(slot.position).shift();
      if (playerId) nextPicks[slot.id] = playerId;
    }
    return nextPicks;
  }

  function getSlot(slotId) { return currentSlots().find((slot) => slot.id === slotId) || null; }

  function activeSlot() {
    const slots = currentSlots();
    return slots.find((slot) => slot.id === state.activeSlotId)
      || slots.find((slot) => !state.picks[slot.id])
      || slots[0];
  }

  function playerForSlot(slot) {
    return slot ? playersById.get(Number(state.picks[slot.id])) || null : null;
  }

  function pickedPlayers(exceptSlotId = null) {
    return currentSlots()
      .filter((slot) => slot.id !== exceptSlotId)
      .map((slot) => playerForSlot(slot))
      .filter(Boolean);
  }

  function spentAmount(exceptSlotId = null) {
    return pickedPlayers(exceptSlotId).reduce((sum, player) => sum + Number(player.price || 0), 0);
  }

  function money(tenths) { return `£${(Number(tenths || 0) / 10).toFixed(1)}m`; }

  function formatNumber(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : "0.0";
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ formation: state.formation, picks: state.picks }));
      elements.saveState.textContent = "Saved on this device";
      elements.saveState.style.color = "";
    } catch {
      elements.saveState.textContent = "Save unavailable in this browser";
      elements.saveState.style.color = "#bd6a53";
    }
  }

  function renderPitch() {
    const slots = startingSlots();
    for (const position of Object.keys(elements.pitchRows)) {
      const row = elements.pitchRows[position];
      row.replaceChildren();
      for (const slot of slots.filter((entry) => POSITION_NAMES[entry.position] === position)) {
        const picked = playerForSlot(slot);
        const wrap = document.createElement("div");
        wrap.className = "pitch-slot";

        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = `slot-main${state.activeSlotId === slot.id ? " is-active" : ""}${picked ? " is-filled" : ""}`;
        choose.setAttribute("aria-pressed", String(state.activeSlotId === slot.id));
        choose.setAttribute("aria-label", `${POSITION_WORDS[slot.position]} ${slot.index}: ${picked ? `${picked.name}, ${money(picked.price)}; select to change` : "choose a player"}`);
        const role = document.createElement("span");
        role.className = "slot-role";
        role.textContent = POSITION_NAMES[slot.position];
        const name = document.createElement("strong");
        name.className = "slot-name";
        name.textContent = picked ? picked.name : `Choose ${POSITION_NAMES[slot.position]}`;
        const fixture = picked ? nextFixture(picked) : null;
        const nextOpponent = document.createElement("span");
        nextOpponent.className = "slot-next-fixture";
        nextOpponent.textContent = fixture ? `Next: ${fixture.opponent} (${fixture.venue}) · GW${fixture.event}` : picked ? "Next fixture not set" : "";
        nextOpponent.title = fixture ? `Next: ${fixture.opponentName} · ${fixture.venue === "H" ? "home" : "away"} · Gameweek ${fixture.event}` : "No upcoming fixture in this data snapshot";
        const price = document.createElement("span");
        price.className = "slot-price";
        price.textContent = picked ? money(picked.price) : "Tap to add";
        choose.append(role, name, nextOpponent, price);
        if (picked && fixture) {
          choose.setAttribute("aria-label", `${POSITION_WORDS[slot.position]} ${slot.index}: ${picked.name}, ${money(picked.price)}; next plays ${fixture.opponentName} ${fixture.venue === "H" ? "at home" : "away"} in gameweek ${fixture.event}; select to change`);
        }
        choose.addEventListener("click", () => selectSlot(slot.id));
        wrap.append(choose);

        if (picked) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "slot-clear";
          remove.textContent = "×";
          remove.setAttribute("aria-label", `Remove ${picked.name}`);
          remove.addEventListener("click", (event) => {
            event.stopPropagation();
            state.picks[slot.id] = null;
            state.activeSlotId = slot.id;
            state.filterPosition = String(slot.position);
            changed(`Removed ${picked.name} from your XI.`);
          });
          wrap.append(remove);
        }
        row.append(wrap);
      }
    }
  }

  function renderBench() {
    const slots = benchSlots();
    if (!elements.benchGrid) return;
    const fragment = document.createDocumentFragment();
    for (const slot of slots) {
      const picked = playerForSlot(slot);
      const item = document.createElement("div");
      item.className = "bench-slot";
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = `bench-slot-main${state.activeSlotId === slot.id ? " is-active" : ""}${picked ? " is-filled" : ""}`;
      choose.setAttribute("aria-pressed", String(state.activeSlotId === slot.id));
      choose.setAttribute("aria-label", `Bench ${POSITION_WORDS[slot.position]}: ${picked ? `${picked.name}, ${money(picked.price)}; select to change` : "choose a player"}`);
      const role = document.createElement("span");
      role.className = "slot-role";
      role.textContent = `BENCH · ${POSITION_NAMES[slot.position]}`;
      const name = document.createElement("strong");
      name.className = "slot-name";
      name.textContent = picked ? picked.name : `Choose ${POSITION_NAMES[slot.position]}`;
      const fixture = picked ? nextFixture(picked) : null;
      const nextOpponent = document.createElement("span");
      nextOpponent.className = "slot-next-fixture";
      nextOpponent.textContent = fixture ? `Next: ${fixture.opponent} (${fixture.venue}) · GW${fixture.event}` : picked ? "Next fixture not set" : "";
      nextOpponent.title = fixture ? `Next: ${fixture.opponentName} · ${fixture.venue === "H" ? "home" : "away"} · Gameweek ${fixture.event}` : "No upcoming fixture in this data snapshot";
      const price = document.createElement("span");
      price.className = "slot-price";
      price.textContent = picked ? money(picked.price) : "Tap to add";
      choose.append(role, name, nextOpponent, price);
      if (picked && fixture) {
        choose.setAttribute("aria-label", `Bench ${POSITION_WORDS[slot.position]}: ${picked.name}, ${money(picked.price)}; next plays ${fixture.opponentName} ${fixture.venue === "H" ? "at home" : "away"} in gameweek ${fixture.event}; select to change`);
      }
      choose.addEventListener("click", () => selectSlot(slot.id));
      item.append(choose);
      if (picked) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "slot-clear bench-clear";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Remove ${picked.name} from the bench`);
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          state.picks[slot.id] = null;
          state.activeSlotId = slot.id;
          state.filterPosition = String(slot.position);
          changed(`Removed ${picked.name} from your bench.`);
        });
        item.append(remove);
      }
      fragment.append(item);
    }
    elements.benchGrid.replaceChildren(fragment);
    const names = slots.map((slot) => POSITION_NAMES[slot.position]);
    if (elements.benchComposition) {
      elements.benchComposition.textContent = `This ${state.formation.replaceAll("-", "–")} leaves ${names.join(" · ")} on the bench and keeps the full squad at 2 GKP · 5 DEF · 5 MID · 3 FWD.`;
    }
  }

  function selectSlot(slotId) {
    const slot = getSlot(slotId);
    if (!slot) return;
    state.activeSlotId = slotId;
    state.filterPosition = String(slot.position);
    renderAll();
  }

  function positionButtons() {
    elements.filters.querySelectorAll("button[data-position]").forEach((button) => {
      const active = button.dataset.position === state.filterPosition;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function teamName(player) { return teamsById.get(Number(player.team))?.name || "Unknown club"; }
  function teamShort(player) { return teamsById.get(Number(player.team))?.short || "FPL"; }

  function nextFixture(player) {
    return futureFixtures(player, 1)[0] || null;
  }

  function pickIssue(player, slot) {
    const alreadyIn = currentSlots().find((entry) => Number(state.picks[entry.id]) === Number(player.id));
    if (alreadyIn && alreadyIn.id !== slot?.id) return "Already in your XI";
    const committed = spentAmount(slot?.id);
    if (committed + Number(player.price || 0) > budgetLimit) return "Over budget";
    const sameClub = pickedPlayers(slot?.id).filter((picked) => Number(picked.team) === Number(player.team)).length;
    if (sameClub >= teamLimit) return "Club limit reached";
    return "";
  }

  function sortPlayers(players) {
    const pointsPerMillion = (player) => Number(player.totalPoints || 0) / Math.max(Number(player.price || 1) / 10, .1);
    const compare = {
      form: (a, b) => Number(b.form || 0) - Number(a.form || 0),
      expected: (a, b) => Number(b.expectedNext || 0) - Number(a.expectedNext || 0),
      points: (a, b) => Number(b.totalPoints || 0) - Number(a.totalPoints || 0),
      value: (a, b) => pointsPerMillion(b) - pointsPerMillion(a),
      "price-low": (a, b) => Number(a.price) - Number(b.price),
      "price-high": (a, b) => Number(b.price) - Number(a.price)
    }[state.sort] || ((a, b) => Number(b.form || 0) - Number(a.form || 0));
    return players.sort((a, b) => compare(a, b) || Number(b.totalPoints || 0) - Number(a.totalPoints || 0) || a.name.localeCompare(b.name));
  }

  function availabilityFlag(player) {
    const chance = player.chanceNext;
    if (player.status && player.status !== "a") return STATUS_NAMES[player.status] || "Status flag";
    if (chance !== null && chance !== undefined && Number(chance) < 100) return `${chance}% chance`;
    return "";
  }

  function renderPlayers() {
    const slot = activeSlot();
    const query = state.query.trim().toLocaleLowerCase();
    let matches = feed.players.filter((player) => {
      if (state.filterPosition !== "ALL" && Number(player.position) !== Number(state.filterPosition)) return false;
      if (state.club !== "ALL" && Number(player.team) !== Number(state.club)) return false;
      if (!query) return true;
      return `${player.name} ${teamName(player)} ${teamShort(player)}`.toLocaleLowerCase().includes(query);
    });
    sortPlayers(matches);
    elements.resultCount.textContent = `${matches.length.toLocaleString()} ${matches.length === 1 ? "player" : "players"}`;
    elements.poolCount.textContent = feed.players.length.toLocaleString();
    elements.activeSlotNote.replaceChildren();
    const note = document.createElement("span");
    note.append("Picking for ");
    const role = document.createElement("b");
    role.textContent = POSITION_NAMES[slot?.position] || "XI";
    note.append(role, document.createTextNode(" · click any squad slot to switch"));
    elements.activeSlotNote.append(note);

    const fragment = document.createDocumentFragment();
    const visible = matches.slice(0, 60);
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "pool-empty";
      empty.textContent = "No players match that search. Try another name or club.";
      fragment.append(empty);
    }
    for (const player of visible) {
      const issue = pickIssue(player, slot);
      const option = document.createElement("button");
      option.type = "button";
      option.className = "player-option";
      option.disabled = Boolean(issue);
      option.title = issue || `Add ${player.name} to ${POSITION_WORDS[slot.position]}`;
      const info = document.createElement("span");
      info.className = "player-info";
      const club = document.createElement("span");
      club.className = "club-mark";
      club.setAttribute("aria-hidden", "true");
      club.textContent = teamShort(player);
      const nameBlock = document.createElement("span");
      nameBlock.className = "player-name-block";
      const name = document.createElement("strong");
      name.textContent = player.name;
      const fixture = nextFixture(player);
      const nextOpponent = document.createElement("span");
      nextOpponent.className = "player-next-fixture";
      nextOpponent.textContent = fixture ? `Next: ${fixture.opponentName} (${fixture.venue}) · GW${fixture.event}` : "Next fixture not set";
      nextOpponent.title = fixture ? `Next: ${fixture.opponentName} · ${fixture.venue === "H" ? "home" : "away"} · Gameweek ${fixture.event}` : "No upcoming fixture in this data snapshot";
      const meta = document.createElement("span");
      meta.className = "player-meta";
      const flag = availabilityFlag(player);
      meta.textContent = `${teamName(player)} · ${POSITION_NAMES[player.position]}${flag ? ` · ${flag}` : ""}`;
      nameBlock.append(name, nextOpponent, meta);
      info.append(club, nameBlock);
      const stats = document.createElement("span");
      stats.className = "player-data";
      const price = document.createElement("strong");
      price.className = "player-price";
      price.textContent = money(player.price);
      const form = document.createElement("span");
      form.className = "player-form";
      form.textContent = `${formatNumber(player.form)} form · ${Number(player.totalPoints || 0)} pts`;
      stats.append(price, form);
      option.append(info, stats);
      option.addEventListener("click", () => addPlayer(player));
      const listItem = document.createElement("div");
      listItem.setAttribute("role", "listitem");
      listItem.append(option);
      fragment.append(listItem);
    }
    elements.playerList.replaceChildren(fragment);
    if (matches.length > visible.length) {
      elements.resultCount.textContent += ` · top ${visible.length} shown`;
    }
    positionButtons();
  }

  function renderBudget() {
    const spent = spentAmount();
    const remaining = Math.max(0, budgetLimit - spent);
    const filled = currentSlots().filter((slot) => playerForSlot(slot)).length;
    const startingFilled = startingSlots().filter((slot) => playerForSlot(slot)).length;
    const benchFilled = benchSlots().filter((slot) => playerForSlot(slot)).length;
    const byClub = new Map();
    pickedPlayers().forEach((player) => byClub.set(Number(player.team), (byClub.get(Number(player.team)) || 0) + 1));
    const maxClubCount = Math.max(0, ...byClub.values());
    const percentage = Math.min(100, Math.round((spent / budgetLimit) * 100));
    elements.budget.innerHTML = `${money(remaining)} <small>remaining</small>`;
    elements.budgetFill.style.width = `${percentage}%`;
    elements.budgetTrack.setAttribute("aria-valuenow", String(percentage));
    elements.pickedCount.innerHTML = `${filled}<span> / 15</span>`;
    elements.clubCount.innerHTML = `${maxClubCount}<span> / ${teamLimit} max</span>`;
    const complete = filled === 15;
    elements.lineupStatus.textContent = complete
      ? `Full squad complete · ${startingFilled} starters + ${benchFilled} bench · ${money(spent)} spent`
      : `${filled} of 15 picked · ${11 - startingFilled} starting and ${4 - benchFilled} bench slots left · ${money(remaining)} remaining`;
  }

  function insightCard(label, title, detail) {
    const card = document.createElement("article");
    card.className = "insight-card";
    const caption = document.createElement("span");
    caption.className = "insight-label";
    caption.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = detail;
    card.append(caption, strong, copy);
    return card;
  }

  function renderInsights() {
    const selected = pickedPlayers();
    const starters = startingSlots().map((slot) => playerForSlot(slot)).filter(Boolean);
    const complete = currentSlots().length === 15 && selected.length === 15;
    if (!complete) {
      const missing = 15 - selected.length;
      elements.insights.replaceChildren(
        insightCard("NEXT STEP", `Pick ${missing} more`, "Complete all 15 squad slots to unlock the full read."),
        insightCard("BUDGET", money(budgetLimit - spentAmount()), "Live spend, updated with each pick."),
        insightCard("SQUAD RULES", "2 · 5 · 5 · 3", "FPL squad totals flex with your starting formation.")
      );
      return;
    }

    const captainPick = [...starters].sort((a, b) => {
      const expectedDifference = Number(b.expectedNext ?? -1) - Number(a.expectedNext ?? -1);
      return expectedDifference || Number(b.form || 0) - Number(a.form || 0);
    })[0];
    const valuePick = [...selected].sort((a, b) => {
      const valueA = Number(a.totalPoints || 0) / Math.max(Number(a.price || 1), 1);
      const valueB = Number(b.totalPoints || 0) / Math.max(Number(b.price || 1), 1);
      return valueB - valueA || Number(b.form || 0) - Number(a.form || 0);
    })[0];
    const flagged = selected.filter((player) => availabilityFlag(player));
    let riskTitle = "No flags spotted";
    let riskDetail = "No availability warning in this snapshot.";
    if (flagged.length) {
      const player = flagged.sort((a, b) => {
        const aChance = a.chanceNext === null ? 0 : Number(a.chanceNext);
        const bChance = b.chanceNext === null ? 0 : Number(b.chanceNext);
        return aChance - bChance;
      })[0];
      riskTitle = player.name;
      riskDetail = `${availabilityFlag(player)}${player.news ? ` · ${player.news}` : " · check before deadline"}`;
    }
    elements.insights.replaceChildren(
      insightCard("CAPTAINCY WATCH", captainPick.name, `${formatNumber(captainPick.expectedNext ?? captainPick.form)} official expected points next GW.`),
      insightCard("VALUE SIGNAL", valuePick.name, `${formatNumber(Number(valuePick.totalPoints || 0) / Math.max(Number(valuePick.price || 1) / 10, .1), 1)} season points per £m.`),
      insightCard("AVAILABILITY", riskTitle, riskDetail)
    );
  }

  function renderAll() {
    renderPitch();
    renderBench();
    renderBudget();
    renderPlayers();
    renderInsights();
  }

  function changed(message = "Team updated.") {
    saveState();
    renderAll();
    if (message) showToast(message);
  }

  function addPlayer(player) {
    const slot = activeSlot();
    if (!slot) return;
    const issue = pickIssue(player, slot);
    if (issue) { showToast(issue); return; }
    if (Number(player.position) !== slot.position) {
      showToast(`Choose a ${POSITION_WORDS[slot.position]} for this slot.`);
      return;
    }
    state.picks[slot.id] = Number(player.id);
    const nextEmpty = currentSlots().find((entry) => !state.picks[entry.id]);
    if (nextEmpty) {
      state.activeSlotId = nextEmpty.id;
      state.filterPosition = String(nextEmpty.position);
    }
    changed(`${player.name} added to your ${slot.group === "bench" ? "bench" : "starting XI"}.`);
  }

  function setupClubs() {
    const fragment = document.createDocumentFragment();
    [...feed.teams].sort((a, b) => a.name.localeCompare(b.name)).forEach((team) => {
      const option = document.createElement("option");
      option.value = String(team.id);
      option.textContent = team.name;
      fragment.append(option);
    });
    elements.clubFilter.append(fragment);
  }

  function setupFeedLabels() {
    const date = new Date(`${feed.updated}T12:00:00Z`);
    const formatted = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date).toUpperCase();
    document.querySelectorAll("[data-feed-date]").forEach((node) => { node.textContent = formatted; });
    const gameweek = $("#gameweek-chip");
    if (gameweek) gameweek.textContent = feed.gameweek || feed.season;
  }

  function setupEvents() {
    if (elements.submissionForm) elements.submissionForm.addEventListener("submit", submitSquad);

    elements.formation.addEventListener("change", () => {
      const proposed = elements.formation.value;
      if (!FORMATIONS.includes(proposed)) {
        elements.formation.value = state.formation;
        showToast("Choose one of the legal FPL starting formations.");
        return;
      }
      state.picks = reflowPicks(proposed);
      state.formation = proposed;
      const slot = activeSlot();
      state.activeSlotId = slot.id;
      state.filterPosition = String(slot.position);
      changed(`Formation changed to ${proposed.replaceAll("-", "–")}; your bench now follows the FPL squad rules.`);
    });

    elements.filters.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-position]");
      if (!button) return;
      state.filterPosition = button.dataset.position;
      renderPlayers();
    });

    elements.search.addEventListener("input", () => {
      state.query = elements.search.value;
      renderPlayers();
    });

    elements.clubFilter.addEventListener("change", () => {
      state.club = elements.clubFilter.value;
      renderPlayers();
    });

    elements.sort.addEventListener("change", () => {
      state.sort = elements.sort.value;
      renderPlayers();
    });

    $("#reset-team").addEventListener("click", () => {
      if (!Object.values(state.picks).some(Boolean)) {
        showToast("Your squad is already empty.");
        return;
      }
      if (!window.confirm("Clear all 15 squad slots and start again?")) return;
      state.picks = {};
      state.formation = "4-4-2";
      state.activeSlotId = "GKP-1";
      state.filterPosition = "1";
      elements.formation.value = state.formation;
      changed("Your full squad has been cleared.");
    });

    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        elements.search.focus();
      }
    });
  }

  function futureFixtures(player, limit = 5) {
    const firstEvent = Number(feed.nextEvent || 0);
    const upcoming = (feed.fixtures || [])
      .filter((fixture) => Number(fixture.event) >= firstEvent && (Number(fixture.home) === Number(player.team) || Number(fixture.away) === Number(player.team)))
      .sort((a, b) => Number(a.event) - Number(b.event) || String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
    const includedEvents = new Set([...new Set(upcoming.map((fixture) => Number(fixture.event)))].slice(0, limit));
    return upcoming
      .filter((fixture) => includedEvents.has(Number(fixture.event)))
      .map((fixture) => {
        const home = Number(fixture.home) === Number(player.team);
        const opponentId = home ? Number(fixture.away) : Number(fixture.home);
        return {
          event: Number(fixture.event),
          opponent: teamsById.get(opponentId)?.short || "TBC",
          opponentName: teamsById.get(opponentId)?.name || teamsById.get(opponentId)?.short || "Opponent TBC",
          venue: home ? "H" : "A",
          difficulty: Number(home ? fixture.homeDifficulty : fixture.awayDifficulty)
        };
      });
  }

  function averageDifficulty(fixtures) {
    return fixtures.length ? fixtures.reduce((sum, fixture) => sum + fixture.difficulty, 0) / fixtures.length : null;
  }

  function forecastScore(player, fixtures = futureFixtures(player)) {
    const difficulty = averageDifficulty(fixtures);
    const minutes = Number(player.minutes || 0);
    return Number(player.expectedNext || 0) * 1.8
      + Number(player.form || 0) * 0.42
      + Math.min(minutes / 180, 2) * 0.18
      - (difficulty === null ? 3 : difficulty) * 0.42;
  }

  function suggestedAlternative(player, selectedIds, bank, fixturesByPlayer) {
    const currentScore = forecastScore(player, fixturesByPlayer.get(Number(player.id)));
    return feed.players
      .filter((candidate) => Number(candidate.position) === Number(player.position)
        && Number(candidate.id) !== Number(player.id)
        && !selectedIds.has(Number(candidate.id))
        && candidate.status === "a"
        && Number(candidate.price || 0) <= Number(player.price || 0) + bank
        && (Number(candidate.expectedNext || 0) > Number(player.expectedNext || 0) + 0.3
          || Number(candidate.form || 0) > Number(player.form || 0) + 0.8))
      .map((candidate) => ({ player: candidate, score: forecastScore(candidate, fixturesByPlayer.get(Number(candidate.id))) }))
      .filter((entry) => entry.score > currentScore + 0.3)
      .sort((a, b) => b.score - a.score || Number(b.player.totalPoints || 0) - Number(a.player.totalPoints || 0))[0]?.player || null;
  }

  function percentileForPosition(player, metric) {
    const pool = feed.players.filter((candidate) => Number(candidate.position) === Number(player.position)
      && candidate.status === "a");
    if (!pool.length) return 50;
    const value = Number(player[metric] || 0);
    const below = pool.filter((candidate) => Number(candidate[metric] || 0) < value).length;
    const tied = pool.filter((candidate) => Number(candidate[metric] || 0) === value).length;
    return ((below + tied / 2) / pool.length) * 100;
  }

  function availabilityScore(player) {
    const chance = player.chanceNext;
    if (chance !== null && chance !== undefined && Number.isFinite(Number(chance))) {
      return Math.max(0, Math.min(100, Number(chance)));
    }
    return ({ d: 55, i: 25, s: 0, u: 0, n: 0 })[player.status] ?? 100;
  }

  function buildSquadScore(players) {
    const weights = { expectedPoints: 0.45, recentForm: 0.25, fixtureEase: 0.15, availability: 0.15 };
    const groupWeights = { starting: 0.75 / 11, bench: 0.25 / 4 };
    const components = Object.fromEntries(Object.keys(weights).map((key) => [key, 0]));

    players.forEach((player) => {
      const roleWeight = groupWeights[player.group] || 0;
      const fixtureEase = player.averageDifficulty === null
        ? 50
        : Math.max(0, Math.min(100, ((5 - player.averageDifficulty) / 4) * 100));
      const values = {
        expectedPoints: percentileForPosition(player, "expectedNext"),
        recentForm: percentileForPosition(player, "form"),
        fixtureEase,
        availability: availabilityScore(player)
      };
      Object.keys(components).forEach((key) => { components[key] += values[key] * roleWeight; });
    });

    const value = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key] * weight, 0));
    const label = value >= 85 ? "Excellent outlook"
      : value >= 70 ? "Strong outlook"
        : value >= 55 ? "Mixed outlook" : "Needs attention";
    return {
      value,
      label,
      components: Object.fromEntries(Object.entries(components).map(([key, score]) => [key, Math.round(score)])),
      weights
    };
  }

  function analyzeSquad() {
    const members = currentSlots().map((slot) => ({
      ...slot,
      player: playerForSlot(slot)
    })).filter((entry) => entry.player);
    const starters = members.filter((entry) => entry.group === "starting");
    const bench = members.filter((entry) => entry.group === "bench");
    const selectedIds = new Set(members.map((entry) => Number(entry.player.id)));
    const fixtureMap = new Map(members.map((entry) => [Number(entry.player.id), futureFixtures(entry.player)]));
    const playerReports = members.map(({ player, group, position }) => {
      const fixtures = fixtureMap.get(Number(player.id)) || [];
      const difficulty = averageDifficulty(fixtures);
      const flag = availabilityFlag(player);
      const minutes = Number(player.minutes || 0);
      const expected = Number(player.expectedNext || 0);
      const watch = [];
      if (flag) watch.push(`${flag}${player.news ? ` — ${player.news}` : ""}`);
      if (minutes > 0 && minutes < 180) watch.push(`Only ${minutes} minutes so far; starting security is uncertain.`);
      if (difficulty !== null && difficulty >= 3.6) watch.push("A difficult run in the next five fixtures.");
      if (expected < 1 && Number(player.form || 0) < 1 && !flag) watch.push("Recent output is quiet; monitor before the deadline.");
      const alternative = suggestedAlternative(player, selectedIds, Math.max(0, budgetLimit - spentAmount()) + Number(player.price || 0), fixtureMap);
      const action = alternative
        ? `Compare ${alternative.name} (£${(Number(alternative.price) / 10).toFixed(1)}m) as a possible switch.`
        : watch.length ? "Check team news before locking this pick." : "No urgent switch from this snapshot.";
      return {
        id: Number(player.id),
        name: player.name,
        position,
        group,
        club: teamName(player),
        price: Number(player.price || 0),
        expectedNext: expected,
        form: Number(player.form || 0),
        totalPoints: Number(player.totalPoints || 0),
        minutes,
        goals: Number(player.goals || 0),
        assists: Number(player.assists || 0),
        cleanSheets: Number(player.cleanSheets || 0),
        expectedGoals: Number(player.expectedGoals || 0),
        expectedAssists: Number(player.expectedAssists || 0),
        expectedGoalInvolvements: Number(player.expectedGoalInvolvements || 0),
        selectedBy: Number(player.selectedBy || 0),
        availability: flag || "No current flag",
        news: player.news || "",
        fixtures,
        averageDifficulty: difficulty,
        watch,
        action,
        alternative: alternative ? { name: alternative.name, price: Number(alternative.price || 0) } : null
      };
    });
    const starterReports = playerReports.filter((player) => player.group === "starting");
    const allFixtures = starterReports.flatMap((player) => player.fixtures);
    const avgDifficulty = averageDifficulty(allFixtures);
    const captain = [...starterReports].sort((a, b) => b.expectedNext - a.expectedNext || b.form - a.form)[0] || null;
    const value = [...playerReports].sort((a, b) => b.totalPoints / Math.max(b.price, 1) - a.totalPoints / Math.max(a.price, 1))[0] || null;
    const flagged = playerReports.filter((player) => player.availability !== "No current flag");
    const squadScore = buildSquadScore(playerReports);
    const greenFixtures = allFixtures.filter((fixture) => fixture.difficulty <= 2).length;
    const difficultFixtures = allFixtures.filter((fixture) => fixture.difficulty >= 4).length;
    const outlook = avgDifficulty === null ? "Fixture data unavailable"
      : avgDifficulty <= 2.5 ? "Favourable run"
        : avgDifficulty <= 3.35 ? "Mixed run" : "Tough run";
    const teamRecommendations = [];
    if (captain) teamRecommendations.push({
      label: "Captaincy watch",
      title: captain.name,
      detail: `${captain.expectedNext.toFixed(1)} official FPL expected points next gameweek; compare with your own read before the deadline.`
    });
    if (value) teamRecommendations.push({
      label: "Season value signal",
      title: value.name,
      detail: `${(value.totalPoints / Math.max(value.price / 10, 0.1)).toFixed(1)} season points per £m so far; historical value does not guarantee future returns.`
    });
    if (flagged.length) teamRecommendations.push({
      label: "Availability check",
      title: `${flagged.length} squad ${flagged.length === 1 ? "player" : "players"} flagged`,
      detail: `${flagged.slice(0, 3).map((player) => player.name).join(", ")}${flagged.length > 3 ? " and others" : ""} need a team-news check.`
    });
    if (avgDifficulty !== null) teamRecommendations.push({
      label: "Fixture outlook",
      title: outlook,
      detail: `${greenFixtures} easier and ${difficultFixtures} tougher fixtures across the XI’s next five gameweeks (average FDR ${avgDifficulty.toFixed(1)}).`
    });
    const switchWatch = playerReports.filter((player) => player.alternative || player.watch.length).slice(0, 4);
    switchWatch.forEach((player) => teamRecommendations.push({
      label: player.group === "bench" ? "Bench watch" : "Transfer watch",
      title: player.name,
      detail: player.action
    }));
    return {
      formation: state.formation,
      createdAt: new Date().toISOString(),
      squadValue: spentAmount(),
      bank: Math.max(0, budgetLimit - spentAmount()),
      expectedStartingPoints: starterReports.reduce((sum, player) => sum + player.expectedNext, 0),
      benchExpectedPoints: playerReports.filter((player) => player.group === "bench").reduce((sum, player) => sum + player.expectedNext, 0),
      formTotal: starterReports.reduce((sum, player) => sum + player.form, 0),
      pointsTotal: starterReports.reduce((sum, player) => sum + player.totalPoints, 0),
      averageFixtureDifficulty: avgDifficulty,
      fixtureOutlook: outlook,
      squadScore,
      flaggedCount: flagged.length,
      captain: captain?.name || "—",
      valuePick: value?.name || "—",
      recommendations: teamRecommendations.slice(0, 7),
      players: playerReports
    };
  }

  function validateFullSquad() {
    if (!FORMATIONS.includes(state.formation)) return "Choose a legal FPL starting formation.";
    const slots = currentSlots();
    const selected = slots.map((slot) => ({ slot, player: playerForSlot(slot) }));
    if (selected.length !== 15 || selected.some((entry) => !entry.player)) return "Pick all 15 players before submitting.";
    const ids = selected.map((entry) => Number(entry.player.id));
    if (new Set(ids).size !== 15) return "Each player can only appear once in the squad.";
    if (selected.some(({ slot, player }) => Number(player.position) !== slot.position)) {
      return "Each player must be assigned to a slot matching their official FPL position.";
    }
    const totals = selected.reduce((count, { player }) => {
      count[Number(player.position)] = (count[Number(player.position)] || 0) + 1;
      return count;
    }, {});
    if (totals[1] !== 2 || totals[2] !== 5 || totals[3] !== 5 || totals[4] !== 3) {
      return "The squad needs the official FPL balance: 2 goalkeepers, 5 defenders, 5 midfielders and 3 forwards.";
    }
    const starters = selected.filter(({ slot }) => slot.group === "starting");
    const startingTotals = starters.reduce((count, { player }) => {
      count[Number(player.position)] = (count[Number(player.position)] || 0) + 1;
      return count;
    }, {});
    if (starters.length !== 11 || startingTotals[1] !== 1
      || startingTotals[2] < 3 || startingTotals[2] > 5
      || startingTotals[3] < 2 || startingTotals[3] > 5
      || startingTotals[4] < 1 || startingTotals[4] > 3) {
      return "The starting XI needs 1 goalkeeper, 3–5 defenders, 2–5 midfielders and 1–3 forwards.";
    }
    if (spentAmount() > budgetLimit) return `The squad is over the ${money(budgetLimit)} budget.`;
    const clubCounts = new Map();
    selected.forEach(({ player }) => clubCounts.set(Number(player.team), (clubCounts.get(Number(player.team)) || 0) + 1));
    if ([...clubCounts.values()].some((count) => count > teamLimit)) return `You can choose no more than ${teamLimit} players from one club.`;
    return "";
  }

  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function reviewerEmailBody(record) {
    const analysis = record.analysis;
    const recommendations = (analysis.recommendations || []).map((item) => `- ${item.label}: ${item.title} — ${item.detail}`);
    const squad = (analysis.players || []).map((player) => {
      const fixture = player.fixtures?.[0];
      const next = fixture ? `${fixture.opponentName || fixture.opponent} (${fixture.venue}) · GW${fixture.event}` : "not in snapshot";
      return `- ${player.group === "bench" ? "Bench" : "XI"} ${POSITION_NAMES[player.position]}: ${player.name} · ${player.club} · ${money(player.price)} · next: ${next}`;
    });
    return [
      "FPL Sidekick — squad review request",
      `Submission: ${record.id}`,
      `Manager email: ${record.email}`,
      `Formation: ${record.formation.replaceAll("-", "–")}`,
      `First-pass squad score: ${analysis.squadScore?.value ?? "—"}/100 (${analysis.squadScore?.label || "not calculated"})`,
      "Score rubric: expected points 45%, recent form 25%, fixture ease 15%, availability 15%; starting XI 75%, bench 25%.",
      `Next-GW starting XI estimate: ${Number(analysis.expectedStartingPoints || 0).toFixed(1)} points`,
      `Fixture outlook: ${analysis.fixtureOutlook || "not available"}`,
      "",
      "First-pass recommendations:",
      ...(recommendations.length ? recommendations : ["- No recommendations were generated."]),
      "",
      "Full squad:",
      ...(squad.length ? squad : ["- No player list was saved."])
    ].join("\n");
  }

  async function deliverReviewRequest(record) {
    const formData = new FormData();
    formData.set("email", record.email);
    formData.set("_replyto", record.email);
    formData.set("_subject", `FPL Sidekick review request ${record.id}`);
    formData.set("submission_id", record.id);
    formData.set("formation", record.formation.replaceAll("-", "–"));
    formData.set("submitted_at", record.submittedAt);
    formData.set("message", reviewerEmailBody(record));

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData,
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        const details = Array.isArray(result.errors)
          ? result.errors.map((error) => error.message).filter(Boolean).join(" ")
          : "";
        throw new Error(details || `Formspree returned ${response.status}.`);
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function setSubmissionStatus(message, state = "pending") {
    if (!elements.submissionStatus) return;
    elements.submissionStatus.textContent = message;
    elements.submissionStatus.dataset.state = state;
    elements.submissionStatus.hidden = !message;
  }

  function renderAnalysisReport(record) {
    if (!elements.report || !elements.reportContent) return;
    const analysis = record.analysis;
    const report = document.createElement("div");
    report.className = "report-inner";
    const heading = makeNode("div", "report-heading");
    heading.append(makeNode("p", "eyebrow", "YOUR FIRST-PASS REVIEW"));
    heading.append(makeNode("h2", "", "A data-led read on your squad."));
    heading.append(makeNode("p", "", `Review ${record.id} · ${record.formation.replaceAll("-", "–")} · Your email: ${record.email}`));
    report.append(heading);

    const score = analysis.squadScore || { value: 0, label: "Score unavailable", components: {} };
    const scoreOverview = makeNode("section", "score-overview");
    const scoreDial = makeNode("div", "score-dial");
    scoreDial.style.setProperty("--score", `${Number(score.value) || 0}%`);
    scoreDial.setAttribute("role", "img");
    scoreDial.setAttribute("aria-label", `${Number(score.value) || 0} out of 100`);
    const scoreNumber = makeNode("strong", "", String(Number(score.value) || 0));
    scoreDial.append(scoreNumber, makeNode("span", "", "/100"));
    scoreOverview.append(scoreDial);
    const scoreCopy = makeNode("div", "score-copy");
    scoreCopy.append(makeNode("span", "score-band", score.label));
    scoreCopy.append(makeNode("h3", "", "Your squad score"));
    scoreCopy.append(makeNode("p", "", "A snapshot against players in the same position, using the saved official FPL data. This is a guide, not a points prediction."));
    scoreOverview.append(scoreCopy);
    report.append(scoreOverview);

    const factorSection = makeNode("section", "score-factor-section");
    factorSection.append(makeNode("p", "micro-label", "HOW THE SCORE IS BUILT"));
    const factorGrid = makeNode("div", "score-factor-grid");
    [
      ["Expected points", "expectedPoints", 45],
      ["Recent form", "recentForm", 25],
      ["Fixture ease", "fixtureEase", 15],
      ["Availability", "availability", 15]
    ].forEach(([label, key, weight]) => {
      const card = makeNode("article", "score-factor");
      const top = makeNode("div", "score-factor-top");
      top.append(makeNode("span", "", label), makeNode("strong", "", `${Number(score.components?.[key]) || 0}`));
      const meter = makeNode("div", "score-factor-meter");
      meter.setAttribute("role", "progressbar");
      meter.setAttribute("aria-label", `${label} score`);
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-valuenow", String(Number(score.components?.[key]) || 0));
      const fill = makeNode("span", "");
      fill.style.width = `${Number(score.components?.[key]) || 0}%`;
      meter.append(fill);
      card.append(top, meter, makeNode("p", "", `${weight}% of the total`));
      factorGrid.append(card);
    });
    factorSection.append(factorGrid);
    factorSection.append(makeNode("p", "score-weight-note", "The starting XI contributes 75% of the score and the bench 25%. Player rankings are compared within FPL position."));
    report.append(factorSection);

    const metrics = makeNode("div", "report-metrics");
    [
      ["NEXT GW · STARTING XI", `${analysis.expectedStartingPoints.toFixed(1)} pts`, "Sum of the official FPL expected-points estimates."],
      ["NEXT FIVE · FIXTURES", analysis.fixtureOutlook, analysis.averageFixtureDifficulty === null ? "No fixture difficulty in this snapshot." : `Average difficulty ${analysis.averageFixtureDifficulty.toFixed(1)} / 5.`],
      ["SQUAD CHECK", `${analysis.flaggedCount} availability flags`, ""]
    ].forEach(([label, value, detail], index) => {
      if (index === 2) detail = `${money(analysis.bank)} left in the bank · ${money(analysis.squadValue)} spent.`;
      const card = makeNode("article", "report-metric");
      card.append(makeNode("span", "micro-label", label));
      card.append(makeNode("strong", "", value));
      card.append(makeNode("p", "", detail));
      metrics.append(card);
    });
    report.append(metrics);

    const recommendationSection = makeNode("section", "report-section");
    recommendationSection.append(makeNode("p", "micro-label", "WHAT TO CONSIDER"));
    recommendationSection.append(makeNode("h3", "", "Your review notes"));
    const recommendationList = makeNode("div", "recommendation-list");
    analysis.recommendations.forEach((recommendation) => {
      const item = makeNode("article", "recommendation-item");
      item.append(makeNode("span", "recommendation-label", recommendation.label));
      item.append(makeNode("strong", "", recommendation.title));
      item.append(makeNode("p", "", recommendation.detail));
      recommendationList.append(item);
    });
    recommendationSection.append(recommendationList);
    report.append(recommendationSection);

    const playerSection = makeNode("section", "report-section");
    playerSection.append(makeNode("p", "micro-label", "INDIVIDUAL PLAYER NOTES"));
    playerSection.append(makeNode("h3", "", "Every pick, with the context behind it"));
    const playerGrid = makeNode("div", "report-player-grid");
    analysis.players.forEach((player) => {
      const card = makeNode("article", `report-player${player.group === "bench" ? " is-bench" : ""}`);
      const top = makeNode("div", "report-player-top");
      top.append(makeNode("span", "position-chip", `${player.group === "bench" ? "BENCH · " : "XI · "}${POSITION_NAMES[player.position]}`));
      top.append(makeNode("span", "player-price", money(player.price)));
      card.append(top);
      card.append(makeNode("h4", "", player.name));
      card.append(makeNode("p", "report-player-meta", `${player.club} · ${player.totalPoints} season pts · ${player.minutes} minutes`));
      card.append(makeNode("p", "report-player-stats", `Form ${player.form.toFixed(1)} · next GW ${player.expectedNext.toFixed(1)} xP · ${player.goals} goals · ${player.assists} assists · ${player.cleanSheets} clean sheets · xG ${player.expectedGoals.toFixed(1)} · xA ${player.expectedAssists.toFixed(1)} · owned ${player.selectedBy.toFixed(1)}%`));
      card.append(makeNode("p", "report-player-action", player.action));
      if (player.fixtures.length) {
        const fixtures = makeNode("div", "fixture-chips");
        player.fixtures.forEach((fixture) => {
          const chip = makeNode("span", `fixture-chip difficulty-${fixture.difficulty}`, `GW${fixture.event} ${fixture.venue} ${fixture.opponent} · ${fixture.difficulty}`);
          fixtures.append(chip);
        });
        card.append(fixtures);
      }
      playerGrid.append(card);
    });
    playerSection.append(playerGrid);
    report.append(playerSection);
    report.append(makeNode("p", "report-disclaimer", "This is an automated first-pass analysis of the saved official FPL snapshot, not a guaranteed points prediction. A reviewer can add personal feedback after reviewing your squad."));
    elements.reportContent.replaceChildren(report);
    elements.report.hidden = false;
    elements.report.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitSquad(event) {
    event.preventDefault();
    const issue = validateFullSquad();
    if (issue) { showToast(issue); return; }
    if (!elements.submissionForm.reportValidity()) return;
    const submitButton = elements.submissionForm.querySelector('button[type="submit"]');
    if (!submitButton || submitButton.disabled) return;
    const email = $("#submitter-email").value.trim();
    const analysis = analyzeSquad();
    const record = {
      id: `FS-${Date.now().toString(36).toUpperCase()}`,
      submittedAt: new Date().toISOString(),
      email,
      formation: state.formation,
      analysis
    };
    const originalButton = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.textContent = "Sending your review request…";
    elements.submissionForm.setAttribute("aria-busy", "true");
    setSubmissionStatus("Sending your squad for personal review…");
    renderAnalysisReport(record);

    let sent = false;
    try {
      await deliverReviewRequest(record);
      sent = true;
    } catch (error) {
      console.warn("FPL Sidekick could not confirm Formspree delivery.", error);
    }
    submitButton.disabled = false;
    submitButton.innerHTML = originalButton;
    elements.submissionForm.removeAttribute("aria-busy");
    setSubmissionStatus(
      sent
        ? "Your squad and report reached my inbox. I’ll review them and email you personal feedback from Gmail."
        : "We couldn’t confirm email delivery. Your analysis is shown below; check your connection and try submitting again.",
      sent ? "success" : "error"
    );
    if (sent) showToast("Your squad was sent for personal review.");
    else showToast("Your analysis is ready, but email delivery needs a retry.");
  }

  setupClubs();
  setupFeedLabels();
  setupEvents();
  renderAll();
})();
