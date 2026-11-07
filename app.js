/* Forge Studio — returning-user profile form.
 *
 * Difference from puzzle #5 (cache-prefill): #5 stored a flat {name,email,message}
 * blob and restored it silently on reload. This build stores a STRUCTURED, VERSIONED
 * profile record and uses its metadata (firstVisit / lastVisit / visitCount) to
 * actively recognise the returning user — greeting them by name, showing when they
 * were last here, offering continue-vs-start-fresh, and letting them forget the
 * saved profile. The versioning is what makes graceful migration/reset possible.
 */

const STORAGE_KEY = "forge_profile_v2"; // versioned key — bump on breaking schema changes
const LEGACY_KEY = "forge_profile_v1";  // the old #5-style flat shape, if present
const SCHEMA_VERSION = 2;

const PROFILE_FIELDS = ["name", "email", "company", "role", "contactTime"]; // single-value inputs

/* ---------- storage layer (every read is guarded) ---------- */

function emptyProfile() {
  return { name: "", email: "", company: "", role: "", contactTime: "", interests: [], newsletter: false };
}

function emptyRecord() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: emptyProfile(),
    meta: { firstVisit: null, lastVisit: null, visitCount: 0, lastStep: 1 },
  };
}

// Returns { record, status } where status is "ok" | "empty" | "migrated" | "reset".
function loadRecord() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    // localStorage itself unavailable (private mode / disabled) — behave as first visit.
    return { record: emptyRecord(), status: "empty" };
  }

  if (raw === null) {
    // No v2 data. Is there a legacy v1 blob worth migrating forward?
    const migrated = tryMigrateLegacy();
    if (migrated) return { record: migrated, status: "migrated" };
    return { record: emptyRecord(), status: "empty" };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Corrupt JSON — wipe it and start clean rather than crash the page.
    safeRemove(STORAGE_KEY);
    return { record: emptyRecord(), status: "reset" };
  }

  const record = coerceRecord(parsed);
  if (!record) {
    safeRemove(STORAGE_KEY);
    return { record: emptyRecord(), status: "reset" };
  }
  return { record, status: "ok" };
}

// Validate + repair an unknown object into a well-formed record, or return null if hopeless.
function coerceRecord(obj) {
  if (!obj || typeof obj !== "object") return null;

  // An older in-family schema (e.g. a v1 structured record) can be lifted forward here.
  const rec = emptyRecord();
  const srcProfile = obj.profile && typeof obj.profile === "object" ? obj.profile : obj;

  for (const f of PROFILE_FIELDS) {
    if (typeof srcProfile[f] === "string") rec.profile[f] = srcProfile[f];
  }
  if (Array.isArray(srcProfile.interests)) {
    rec.profile.interests = srcProfile.interests.filter((x) => typeof x === "string");
  }
  rec.profile.newsletter = Boolean(srcProfile.newsletter);

  const meta = obj.meta && typeof obj.meta === "object" ? obj.meta : {};
  rec.meta.firstVisit = typeof meta.firstVisit === "number" ? meta.firstVisit : null;
  rec.meta.lastVisit = typeof meta.lastVisit === "number" ? meta.lastVisit : null;
  rec.meta.visitCount = Number.isFinite(meta.visitCount) ? meta.visitCount : 0;
  rec.meta.lastStep = meta.lastStep === 2 ? 2 : 1;

  // A record is only useful if it carries at least a name or email.
  if (!rec.profile.name && !rec.profile.email) {
    // Still allow it (e.g. a profile that only set preferences), but it won't trigger a greeting.
  }
  return rec;
}

// Lift a legacy #5-style flat {name,email,message} blob into the v2 record, then remove it.
function tryMigrateLegacy() {
  let raw = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch (err) {
    return null;
  }
  if (raw === null) return null;

  let old;
  try {
    old = JSON.parse(raw);
  } catch (err) {
    safeRemove(LEGACY_KEY);
    return null;
  }
  if (!old || typeof old !== "object") {
    safeRemove(LEGACY_KEY);
    return null;
  }

  const rec = emptyRecord();
  if (typeof old.name === "string") rec.profile.name = old.name;
  if (typeof old.email === "string") rec.profile.email = old.email;
  // v1 had no company/role/interests — leave them empty. Treat migration as a prior visit.
  rec.meta.firstVisit = Date.now();
  rec.meta.lastVisit = Date.now();
  rec.meta.visitCount = 1;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
    safeRemove(LEGACY_KEY);
  } catch (err) {
    /* best effort */
  }
  return rec;
}

function saveRecord(record) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch (err) {
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    /* ignore */
  }
}

/* ---------- DOM helpers ---------- */

const $ = (sel) => document.querySelector(sel);

function readFormIntoProfile() {
  const profile = emptyProfile();
  for (const f of PROFILE_FIELDS) {
    const el = document.getElementById(f);
    if (el) profile[f] = el.value;
  }
  profile.interests = Array.from(
    document.querySelectorAll('input[name="interests"]:checked')
  ).map((el) => el.value);
  profile.newsletter = $("#newsletter").checked;
  return profile;
}

function writeProfileIntoForm(profile) {
  for (const f of PROFILE_FIELDS) {
    const el = document.getElementById(f);
    if (el) el.value = profile[f] || "";
  }
  document.querySelectorAll('input[name="interests"]').forEach((el) => {
    el.checked = Array.isArray(profile.interests) && profile.interests.includes(el.value);
  });
  $("#newsletter").checked = Boolean(profile.newsletter);
}

function clearFormFields() {
  for (const f of PROFILE_FIELDS) {
    const el = document.getElementById(f);
    if (el) el.value = "";
  }
  document.querySelectorAll('input[name="interests"]').forEach((el) => (el.checked = false));
  $("#newsletter").checked = false;
}

function goToStep(step) {
  document.querySelectorAll(".section").forEach((s) => {
    s.classList.toggle("is-active", Number(s.dataset.section) === step);
  });
  document.querySelectorAll(".step").forEach((b) => {
    const active = Number(b.dataset.step) === step;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function formatRelative(ts) {
  if (!ts) return "just now";
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function hasIdentity(record) {
  return Boolean(record.profile.name || record.profile.email);
}

function updateStorageIndicator(present) {
  const el = $("#storageIndicator");
  if (present) {
    el.textContent = "Profile stored on this device";
    el.classList.add("has-data");
  } else {
    el.textContent = "No profile stored on this device";
    el.classList.remove("has-data");
  }
}

/* ---------- app state + wiring ---------- */

let state = emptyRecord();

// displayLastVisit is the PREVIOUS visit time (when they were last here), passed
// in explicitly because by the time we greet them we have already stamped "now"
// onto the record. displayVisitCount is the already-incremented count for this visit.
function showWelcome(record, displayLastVisit, displayVisitCount) {
  const name = record.profile.name || record.profile.email || "there";
  $("#welcomeHeading").textContent = `Welcome back, ${name}`;
  $("#lastVisitText").textContent = formatRelative(displayLastVisit);
  $("#visitCountText").textContent = String(displayVisitCount);
  $("#welcomeBanner").hidden = false;
}

function init() {
  const { record, status } = loadRecord();
  state = record;

  const returning = hasIdentity(record) && (record.meta.visitCount > 0 || record.meta.lastVisit);

  if (returning) {
    // Return visit: capture the PREVIOUS visit time for "last here", then record
    // this visit (increment count, stamp now) and greet with the updated count.
    const prevLastVisit = record.meta.lastVisit;

    state.meta.visitCount = (state.meta.visitCount || 0) + 1;
    state.meta.lastVisit = Date.now();
    saveRecord(state);

    showWelcome(state, prevLastVisit, state.meta.visitCount);
    writeProfileIntoForm(state.profile);
    goToStep(state.meta.lastStep || 1);
    updateStorageIndicator(true);
  } else {
    // First visit: empty form, no banner.
    $("#welcomeBanner").hidden = true;
    goToStep(1);
    updateStorageIndicator(hasIdentity(record));
  }

  if (status === "reset") {
    showNotice("We could not read your previously saved profile, so we have started you fresh.");
  } else if (status === "migrated") {
    showNotice("We upgraded your saved details from an earlier version of this form.");
  }

  wireEvents();
}

function showNotice(msg) {
  const el = $("#recoveryNotice");
  el.textContent = msg;
  el.hidden = false;
}

function wireEvents() {
  // Stepper buttons.
  document.querySelectorAll(".step").forEach((b) => {
    b.addEventListener("click", () => goToStep(Number(b.dataset.step)));
  });
  document.querySelectorAll("[data-goto]").forEach((b) => {
    b.addEventListener("click", () => goToStep(Number(b.dataset.goto)));
  });

  // Remember which step the user is on, live, so "Continue" lands them back there.
  document.querySelectorAll(".step, [data-goto]").forEach((b) => {
    b.addEventListener("click", () => {
      const step = Number(b.dataset.step || b.dataset.goto);
      if (hasIdentity(state)) {
        state.meta.lastStep = step;
        saveRecord(state);
      }
    });
  });

  // Save / submit.
  $("#profileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const profile = readFormIntoProfile();

    if (!profile.name && !profile.email) {
      $("#saveStatus").textContent = "Add at least a name or email so we can recognise you next time.";
      $("#saveStatus").style.color = "var(--danger)";
      goToStep(1);
      return;
    }

    state.profile = profile;
    if (!state.meta.firstVisit) state.meta.firstVisit = Date.now();
    state.meta.lastVisit = Date.now();
    if (!state.meta.visitCount) state.meta.visitCount = 1;
    state.meta.lastStep = 2;

    const ok = saveRecord(state);
    $("#saveStatus").style.color = "var(--good)";
    $("#saveStatus").textContent = ok
      ? "Saved. We will remember you on your next visit to this device."
      : "We could not save to this browser (storage may be disabled).";
    updateStorageIndicator(ok && hasIdentity(state));
  });

  // Continue where you left off — keep prefilled values, jump to the saved step.
  $("#continueBtn").addEventListener("click", () => {
    writeProfileIntoForm(state.profile);
    goToStep(state.meta.lastStep || 1);
    $("#welcomeBanner").hidden = true;
  });

  // Start fresh — blank the VISIBLE fields for this session WITHOUT wiping saved data.
  $("#startFreshBtn").addEventListener("click", () => {
    clearFormFields();
    goToStep(1);
    $("#welcomeBanner").hidden = true;
    $("#saveStatus").style.color = "var(--ink-dim)";
    $("#saveStatus").textContent = "Started a fresh form. Your saved profile is untouched until you save over it.";
  });

  // "Not you? Clear my info" (in the banner) and the footer privacy link both hard-wipe the key.
  $("#forgetBtn").addEventListener("click", forgetEverything);
  $("#clearDataBtn").addEventListener("click", forgetEverything);
}

function forgetEverything() {
  safeRemove(STORAGE_KEY);
  safeRemove(LEGACY_KEY);
  state = emptyRecord();
  clearFormFields();
  goToStep(1);
  $("#welcomeBanner").hidden = true;
  $("#recoveryNotice").hidden = true;
  updateStorageIndicator(false);
  $("#saveStatus").style.color = "var(--ink-dim)";
  $("#saveStatus").textContent = "Your saved profile has been removed from this device.";
}

document.addEventListener("DOMContentLoaded", init);
