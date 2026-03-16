const STORAGE_KEY = "training-credit-tracker-v1";
const CREDITS_PER_BLOCK = 8;
const MINUTES_PER_CREDIT = 30;

const config = window.APP_CONFIG || {};
const hasSupabaseConfig = Boolean(
  window.supabase?.createClient && config.supabaseUrl && config.supabaseAnonKey,
);
const supabaseClient = hasSupabaseConfig
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

const paymentForm = document.querySelector("#payment-form");
const useForm = document.querySelector("#use-form");
const paymentDateInput = document.querySelector("#payment-date");
const paymentBlocksInput = document.querySelector("#payment-blocks");
const paymentNoteInput = document.querySelector("#payment-note");
const useDateInput = document.querySelector("#use-date");
const useCreditsInput = document.querySelector("#use-credits");
const useNoteInput = document.querySelector("#use-note");
const formMessage = document.querySelector("#form-message");
const statusPill = document.querySelector("#status-pill");
const historyBody = document.querySelector("#history-body");
const historyRowTemplate = document.querySelector("#history-row-template");
const emptyState = document.querySelector("#empty-state");
const creditGrid = document.querySelector("#credit-grid");
const progressFill = document.querySelector("#progress-fill");
const progressCopy = document.querySelector("#progress-copy");
const exportButton = document.querySelector("#export-button");
const importLabel = document.querySelector("#import-label");
const importInput = document.querySelector("#import-input");
const clearButton = document.querySelector("#clear-button");
const authModeCopy = document.querySelector("#auth-mode-copy");
const authStateCopy = document.querySelector("#auth-state-copy");
const authForm = document.querySelector("#auth-form");
const authEmailInput = document.querySelector("#auth-email");
const authPasswordInput = document.querySelector("#auth-password");
const signedInPanel = document.querySelector("#signed-in-panel");
const signedInIdentity = document.querySelector("#signed-in-identity");
const signOutButton = document.querySelector("#sign-out-button");

const metrics = {
  purchasedTime: document.querySelector("#purchased-time"),
  purchasedCredits: document.querySelector("#purchased-credits"),
  usedTime: document.querySelector("#used-time"),
  usedCredits: document.querySelector("#used-credits"),
  remainingTime: document.querySelector("#remaining-time"),
  remainingCredits: document.querySelector("#remaining-credits"),
  remainingSessions: document.querySelector("#remaining-sessions"),
  paymentsCount: document.querySelector("#payments-count"),
  sessionsCount: document.querySelector("#sessions-count"),
};

let state = {
  entries: hasSupabaseConfig ? [] : loadLocalEntries(),
  mode: hasSupabaseConfig ? "supabase" : "local",
  user: null,
};

void init();

async function init() {
  const today = new Date().toISOString().split("T")[0];
  paymentDateInput.value = today;
  useDateInput.value = today;

  paymentForm.addEventListener("submit", handlePaymentSubmit);
  useForm.addEventListener("submit", handleUseSubmit);
  exportButton.addEventListener("click", exportBackup);
  importInput.addEventListener("change", handleImport);
  clearButton.addEventListener("click", clearAllEntries);
  authForm.addEventListener("submit", handleAuthSubmit);
  signOutButton.addEventListener("click", handleSignOut);

  if (hasSupabaseConfig) {
    const {
      data: { session },
      error,
    } = await supabaseClient.auth.getSession();

    if (error) {
      setFormMessage("Could not check the current login session.", true);
    }

    state.user = session?.user || null;

    supabaseClient.auth.onAuthStateChange(async (_event, sessionData) => {
      state.user = sessionData?.user || null;
      updateAccessUi();

      if (state.user) {
        await loadRemoteEntries();
        setFormMessage("Secure sync active.");
      } else {
        state.entries = [];
        render();
      }
    });

    if (state.user) {
      await loadRemoteEntries();
    }
  }

  updateAccessUi();
  render();
}

function loadLocalEntries() {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) {
      return [];
    }

    return parsed.entries
      .filter(isValidEntry)
      .map((entry, index) => normalizeLocalEntry(entry, index + 1));
  } catch {
    return [];
  }
}

function saveLocalEntries() {
  if (state.mode !== "local") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: state.entries }));
}

function isValidEntry(entry) {
  return (
    entry &&
    typeof entry.id === "string" &&
    (entry.type === "purchase" || entry.type === "use") &&
    typeof entry.date === "string" &&
    Number.isInteger(entry.credits) &&
    entry.credits > 0 &&
    typeof entry.note === "string"
  );
}

function normalizeLocalEntry(entry, fallbackSequence) {
  return {
    id: entry.id,
    type: entry.type,
    date: entry.date,
    credits: entry.credits,
    note: entry.note,
    sequence: Number.isInteger(entry.sequence) ? entry.sequence : fallbackSequence,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
  };
}

function mapRemoteEntry(row) {
  return {
    id: row.id,
    type: row.entry_type,
    date: row.event_date,
    credits: row.credits,
    note: row.note || "",
    createdAt: row.created_at || "",
  };
}

function updateAccessUi() {
  const isSignedIn = Boolean(state.user);

  if (state.mode === "supabase") {
    authModeCopy.textContent = isSignedIn ? "Secure sync" : "Supabase";
    authStateCopy.textContent = isSignedIn
      ? "Ledger is stored in Supabase."
      : "Sign in with email + password.";
    authForm.hidden = isSignedIn;
    signedInPanel.hidden = !isSignedIn;
    signedInIdentity.textContent = state.user?.email || "";
  } else {
    authModeCopy.textContent = "Local demo";
    authStateCopy.textContent = "Browser-only storage until Supabase is connected.";
    authForm.hidden = true;
    signedInPanel.hidden = true;
  }

  setInteractionState();
}

function setInteractionState() {
  const canEdit = state.mode === "local" || Boolean(state.user);

  setFormControlsDisabled(paymentForm, !canEdit);
  setFormControlsDisabled(useForm, !canEdit);

  importLabel.hidden = state.mode === "supabase";
  clearButton.hidden = state.mode === "supabase";
  exportButton.disabled = state.entries.length === 0;
}

function setFormControlsDisabled(form, isDisabled) {
  for (const element of form.elements) {
    element.disabled = isDisabled;
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!hasSupabaseConfig) {
    return;
  }

  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;

  if (!email || !password) {
    setFormMessage("Enter email and password.", true);
    return;
  }

  setFormMessage("Signing in...");

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    setFormMessage(error.message, true);
    return;
  }

  authForm.reset();
}

async function handleSignOut() {
  if (!hasSupabaseConfig) {
    return;
  }

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    setFormMessage(error.message, true);
    return;
  }

  state.entries = [];
  setFormMessage("Signed out.");
  render();
}

async function loadRemoteEntries() {
  if (!state.user) {
    state.entries = [];
    render();
    return;
  }

  const { data, error } = await supabaseClient
    .from("ledger_entries")
    .select("id, event_date, entry_type, credits, note, created_at")
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    setFormMessage(error.message, true);
    state.entries = [];
    render();
    return;
  }

  state.entries = data.map(mapRemoteEntry);
  render();
}

async function handlePaymentSubmit(event) {
  event.preventDefault();

  const blocks = Number.parseInt(paymentBlocksInput.value, 10);
  const date = paymentDateInput.value;
  const note = paymentNoteInput.value.trim();

  if (!date || Number.isNaN(blocks) || blocks < 1) {
    setFormMessage("Enter a valid payment date and at least one block.", true);
    return;
  }

  const entry = {
    type: "purchase",
    date,
    credits: blocks * CREDITS_PER_BLOCK,
    note,
  };

  const success = await insertEntry(entry);
  if (!success) {
    return;
  }

  paymentForm.reset();
  paymentDateInput.value = date;
  paymentBlocksInput.value = "1";
  setFormMessage(`Added ${blocks} payment block${blocks === 1 ? "" : "s"}.`);
}

async function handleUseSubmit(event) {
  event.preventDefault();

  const credits = Number.parseInt(useCreditsInput.value, 10);
  const date = useDateInput.value;
  const note = useNoteInput.value.trim();
  const totals = calculateTotals(state.entries);

  if (!date || Number.isNaN(credits) || credits < 1) {
    setFormMessage("Enter a valid date and at least one credit used.", true);
    return;
  }

  if (credits > totals.remainingCredits) {
    setFormMessage("You cannot use more credits than remain.", true);
    return;
  }

  const entry = {
    type: "use",
    date,
    credits,
    note,
  };

  if (state.mode === "local") {
    const candidateEntry = {
      ...entry,
      id: crypto.randomUUID(),
      sequence: getNextSequence(state.entries),
      createdAt: new Date().toISOString(),
    };

    if (!isLedgerChronologicallyValid([...state.entries, candidateEntry])) {
      setFormMessage(
        "That usage date would make the balance go negative before a payment was logged.",
        true,
      );
      return;
    }
  }

  const success = await insertEntry(entry);
  if (!success) {
    return;
  }

  useForm.reset();
  useDateInput.value = date;
  useCreditsInput.value = "1";
  setFormMessage(`Recorded ${credits} used credit${credits === 1 ? "" : "s"}.`);
}

async function insertEntry(entry) {
  if (state.mode === "supabase") {
    if (!state.user) {
      setFormMessage("Sign in before changing credits.", true);
      return false;
    }

    const { error } = await supabaseClient.from("ledger_entries").insert({
      event_date: entry.date,
      entry_type: entry.type,
      credits: entry.credits,
      note: entry.note,
    });

    if (error) {
      setFormMessage(error.message, true);
      return false;
    }

    await loadRemoteEntries();
    return true;
  }

  state.entries.push({
    id: crypto.randomUUID(),
    type: entry.type,
    date: entry.date,
    credits: entry.credits,
    note: entry.note,
    sequence: getNextSequence(state.entries),
    createdAt: new Date().toISOString(),
  });

  saveLocalEntries();
  render();
  return true;
}

function calculateTotals(entries) {
  let purchasedCredits = 0;
  let usedCredits = 0;
  let paymentsCount = 0;
  let sessionsCount = 0;

  for (const entry of entries) {
    if (entry.type === "purchase") {
      purchasedCredits += entry.credits;
      paymentsCount += 1;
    } else {
      usedCredits += entry.credits;
      sessionsCount += entry.credits;
    }
  }

  return {
    purchasedCredits,
    usedCredits,
    remainingCredits: purchasedCredits - usedCredits,
    paymentsCount,
    sessionsCount,
  };
}

function render() {
  const totals = calculateTotals(state.entries);
  const progressPercent =
    totals.purchasedCredits === 0
      ? 0
      : Math.round((totals.usedCredits / totals.purchasedCredits) * 100);

  metrics.purchasedTime.textContent = formatCreditsAsTime(totals.purchasedCredits);
  metrics.purchasedCredits.textContent = formatCreditsLabel(totals.purchasedCredits);
  metrics.usedTime.textContent = formatCreditsAsTime(totals.usedCredits);
  metrics.usedCredits.textContent = formatCreditsLabel(totals.usedCredits);
  metrics.remainingTime.textContent = formatCreditsAsTime(totals.remainingCredits);
  metrics.remainingCredits.textContent = formatCreditsLabel(totals.remainingCredits);
  metrics.remainingSessions.textContent = String(totals.remainingCredits);
  metrics.paymentsCount.textContent = String(totals.paymentsCount);
  metrics.sessionsCount.textContent = String(totals.sessionsCount);

  progressFill.style.width = `${Math.max(0, Math.min(progressPercent, 100))}%`;
  progressCopy.textContent = `${progressPercent}% used`;
  statusPill.textContent = describeStatus(totals.remainingCredits);

  emptyState.textContent =
    state.mode === "supabase" && !state.user ? "Sign in to view entries." : "No entries yet.";

  updateAccessUi();
  renderCreditStrip(totals.remainingCredits);
  renderHistory();
}

function renderCreditStrip(remainingCredits) {
  creditGrid.innerHTML = "";

  if (remainingCredits === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "credit-chip empty";
    placeholder.textContent = "0";
    creditGrid.appendChild(placeholder);
    return;
  }

  for (let index = 0; index < remainingCredits; index += 1) {
    const chip = document.createElement("div");
    chip.className = "credit-chip";
    chip.textContent = String(index + 1);
    chip.title = `Remaining credit ${index + 1}`;
    creditGrid.appendChild(chip);
  }
}

function renderHistory() {
  historyBody.innerHTML = "";

  const orderedEntries = getEntriesWithBalance(state.entries);
  const hasEntries = orderedEntries.length > 0;
  emptyState.hidden = hasEntries;

  for (const entry of orderedEntries) {
    const row = historyRowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".date-cell").textContent = formatDate(entry.date);

    const typeBadge = document.createElement("span");
    typeBadge.className = entry.type;
    typeBadge.textContent = entry.type === "purchase" ? "Payment" : "Used";
    row.querySelector(".type-cell").appendChild(typeBadge);

    const changeCell = row.querySelector(".change-cell");
    changeCell.textContent =
      entry.type === "purchase" ? `+${entry.credits} credits` : `-${entry.credits} credits`;
    changeCell.classList.add(
      entry.type === "purchase" ? "change-positive" : "change-negative",
    );

    row.querySelector(".note-cell").textContent = entry.note || "—";
    row.querySelector(".balance-cell").textContent = formatCreditsAsTime(entry.balanceAfter);

    const deleteButton = row.querySelector(".delete-button");
    deleteButton.dataset.entryId = entry.id;
    deleteButton.disabled = state.mode === "supabase" ? !state.user : false;
    deleteButton.addEventListener("click", () => {
      void deleteEntry(entry.id);
    });

    historyBody.appendChild(row);
  }
}

function getEntriesWithBalance(entries) {
  const chronological = [...entries].sort(compareEntriesChronologically);
  let runningBalance = 0;

  return chronological
    .map((entry) => {
      runningBalance += entry.type === "purchase" ? entry.credits : -entry.credits;
      return {
        ...entry,
        balanceAfter: runningBalance,
      };
    })
    .reverse();
}

function compareEntriesChronologically(first, second) {
  if (first.date !== second.date) {
    return first.date.localeCompare(second.date);
  }

  const firstSequence = Number.isInteger(first.sequence) ? first.sequence : Number.MAX_SAFE_INTEGER;
  const secondSequence = Number.isInteger(second.sequence)
    ? second.sequence
    : Number.MAX_SAFE_INTEGER;

  if (firstSequence !== secondSequence) {
    return firstSequence - secondSequence;
  }

  const firstCreatedAt = first.createdAt || "";
  const secondCreatedAt = second.createdAt || "";

  if (firstCreatedAt !== secondCreatedAt) {
    return firstCreatedAt.localeCompare(secondCreatedAt);
  }

  return first.id.localeCompare(second.id);
}

async function deleteEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);

  if (!entry) {
    return;
  }

  const approved = window.confirm(
    `Delete this ${entry.type === "purchase" ? "payment" : "usage"} entry?`,
  );

  if (!approved) {
    return;
  }

  if (state.mode === "supabase") {
    const { error } = await supabaseClient.from("ledger_entries").delete().eq("id", entryId);

    if (error) {
      setFormMessage(error.message, true);
      return;
    }

    await loadRemoteEntries();
    setFormMessage("Entry deleted.");
    return;
  }

  const nextEntries = state.entries.filter((item) => item.id !== entryId);

  if (!isLedgerChronologicallyValid(nextEntries)) {
    setFormMessage(
      "That delete would make the historical balance go negative. Remove later usage first.",
      true,
    );
    return;
  }

  state.entries = nextEntries;
  saveLocalEntries();
  setFormMessage("Entry deleted.");
  render();
}

function exportBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    mode: state.mode,
    entries: state.entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      date: entry.date,
      credits: entry.credits,
      note: entry.note,
      sequence: entry.sequence,
      createdAt: entry.createdAt,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "workout-credit-tracker-backup.json";
  anchor.click();
  URL.revokeObjectURL(url);

  setFormMessage("Backup exported.");
}

function handleImport(event) {
  if (state.mode !== "local") {
    importInput.value = "";
    return;
  }

  const [file] = event.target.files || [];

  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.entries)) {
        throw new Error("Invalid backup file.");
      }

      const entries = parsed.entries
        .filter(isValidEntry)
        .map((entry, index) => normalizeLocalEntry(entry, index + 1));

      if (entries.length !== parsed.entries.length) {
        throw new Error("Backup contains invalid entries.");
      }

      if (!isLedgerChronologicallyValid(entries)) {
        throw new Error("Backup would create a negative balance.");
      }

      state.entries = entries;
      saveLocalEntries();
      render();
      setFormMessage("Backup imported.");
    } catch {
      setFormMessage("Could not import that backup file.", true);
    } finally {
      importInput.value = "";
    }
  };

  reader.readAsText(file);
}

function clearAllEntries() {
  if (state.mode !== "local") {
    return;
  }

  if (state.entries.length === 0) {
    setFormMessage("There is nothing to clear.", true);
    return;
  }

  const approved = window.confirm("Clear all saved entries from this browser?");
  if (!approved) {
    return;
  }

  state.entries = [];
  saveLocalEntries();
  render();
  setFormMessage("All entries cleared.");
}

function isLedgerChronologicallyValid(entries) {
  const orderedEntries = [...entries].sort(compareEntriesChronologically);
  let runningBalance = 0;

  for (const entry of orderedEntries) {
    runningBalance += entry.type === "purchase" ? entry.credits : -entry.credits;

    if (runningBalance < 0) {
      return false;
    }
  }

  return true;
}

function getNextSequence(entries) {
  return entries.reduce((max, entry) => Math.max(max, entry.sequence || 0), 0) + 1;
}

function describeStatus(remainingCredits) {
  if (remainingCredits <= 0) {
    return "No credits remaining";
  }

  if (remainingCredits <= 2) {
    return "Almost empty";
  }

  if (remainingCredits <= CREDITS_PER_BLOCK) {
    return "Within current block";
  }

  return "Credits available";
}

function formatCreditsAsTime(credits) {
  const totalMinutes = credits * MINUTES_PER_CREDIT;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
}

function formatCreditsLabel(credits) {
  return `${credits} credit${credits === 1 ? "" : "s"}`;
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  );
}

function setFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.style.color = isError ? "var(--danger)" : "var(--sage)";
}
