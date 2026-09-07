import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===================================================================
// SETUP CHECK — evita que la app truene si aún no se configuró Firebase
// ===================================================================
const NEEDS_SETUP = !firebaseConfig.apiKey || firebaseConfig.apiKey === "TU_API_KEY";

if (NEEDS_SETUP) {
  document.getElementById("gate-screen").innerHTML = `
    <div class="login-card" style="max-width:460px; text-align:left;">
      <div class="login-logo">⚙️</div>
      <h1 style="text-align:center;">Falta conectar Firebase</h1>
      <p class="login-sub" style="text-align:center;">Sigue los pasos del archivo <b>README.md</b> para crear tu proyecto gratis de Firebase y pega la configuración en <code>js/firebase-config.js</code>.</p>
      <p class="login-hint" style="text-align:center;">Una vez configurado, recarga esta página.</p>
    </div>`;
  throw new Error("Firebase no configurado. Ver README.md");
}

// ===================================================================
// FIREBASE INIT
// ===================================================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const usersCol = collection(db, "users");
const tasksCol = collection(db, "tasks");

// ===================================================================
// CONSTANTS
// ===================================================================
const TEAM_PASSWORD = "Cheil01";
const COLORS = ["#7c9cff", "#8fd6b4", "#ffcf86", "#ff9d9d", "#8ec9ff", "#c7aef9", "#ffb3d0", "#8fe3d6"];
const STATUSES = ["todo", "in-progress", "done"];

const ICON_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>`;
const ICON_X_SMALL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const ICON_CHECK_SMALL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6"/></svg>`;

// ===================================================================
// STATE
// ===================================================================
let me = null;              // { id, name, avatarType, avatarValue, colorIndex } — id = Firestore profile doc id
let users = {};             // profileId -> user doc (also doubles as the profile directory)
let tasks = [];
let currentView = "board";
let assigneeFilterId = "all";
let activeTaskId = null;
let tasksUnsub = null;
let autoLoginTried = false;
let uploadedPhoto = null;
let newProfileColorIndex = Math.floor(Math.random() * COLORS.length);
let pendingAuthProfile = null;

// ===================================================================
// DOM SHORTCUTS
// ===================================================================
const $ = (sel) => document.querySelector(sel);
const gateScreen = $("#gate-screen");
const profileScreen = $("#profile-screen");
const appEl = $("#app");

// ===================================================================
// PASSWORD HASHING (Web Crypto, client-side — see README for the security trade-offs)
// ===================================================================
function bytesToB64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function b64ToBytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

async function hashPassword(password, existingSaltB64) {
  const salt = existingSaltB64 ? b64ToBytes(existingSaltB64) : crypto.getRandomValues(new Uint8Array(16));
  const passBytes = new TextEncoder().encode(password);
  const combined = new Uint8Array(salt.length + passBytes.length);
  combined.set(salt);
  combined.set(passBytes, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return { saltB64: bytesToB64(salt), hashB64: bytesToB64(new Uint8Array(digest)) };
}

// ===================================================================
// TEAM GATE
// ===================================================================
if (localStorage.getItem("tt_gate_ok") === "1") {
  gateScreen.classList.add("hidden");
  profileScreen.classList.remove("hidden");
  initAfterGate();
} else {
  $("#gate-password").addEventListener("keydown", (e) => { if (e.key === "Enter") submitGate(); });
  $("#gate-btn").addEventListener("click", submitGate);
}

function submitGate() {
  const val = $("#gate-password").value;
  if (val === TEAM_PASSWORD) {
    localStorage.setItem("tt_gate_ok", "1");
    gateScreen.classList.add("hidden");
    profileScreen.classList.remove("hidden");
    initAfterGate();
  } else {
    $("#gate-error").classList.remove("hidden");
    $("#gate-password").value = "";
    $("#gate-password").focus();
  }
}

// ===================================================================
// PROFILE DIRECTORY + PICKER
// ===================================================================
function initAfterGate() {
  signInAnonymously(auth).catch((err) => {
    $("#panel-loading").textContent = "No se pudo conectar con Firebase. Revisa la configuración (ver README.md).";
    console.error(err);
  });
}

let usersListenerStarted = false;
onAuthStateChanged(auth, (user) => {
  if (!user || NEEDS_SETUP || usersListenerStarted) return;
  usersListenerStarted = true;
  onSnapshot(usersCol, (snap) => {
    users = {};
    snap.forEach((d) => { users[d.id] = { id: d.id, ...d.data() }; });

    if (!me) {
      tryAutoLogin();
      renderProfilePicker();
    } else {
      if (users[me.id]) me = { ...me, ...users[me.id] };
      renderTeamList();
      renderAssigneeFilter();
      populateAssigneeSelect();
      renderCurrentView();
    }
  });
});

function tryAutoLogin() {
  if (autoLoginTried) return;
  autoLoginTried = true;
  const savedId = localStorage.getItem("tt_active_profile_id");
  if (savedId && users[savedId]) loginAsProfile(users[savedId]);
}

function showPanel(id) {
  ["panel-loading", "panel-picker", "panel-auth", "panel-create"].forEach((p) => {
    $("#" + p).classList.toggle("hidden", p !== id);
  });
}

function renderProfilePicker() {
  if (me) return;
  showPanel("panel-picker");
  const grid = $("#profile-grid");
  grid.innerHTML = "";
  Object.values(users).forEach((u) => {
    const tile = document.createElement("div");
    tile.className = "profile-tile";
    tile.innerHTML = `<span class="avatar-sm">${avatarHTML(u)}</span><span class="profile-tile-name">${escapeHTML(u.name)}</span>`;
    tile.addEventListener("click", () => openAuthPanel(u));
    grid.appendChild(tile);
  });
}

$("#new-profile-btn").addEventListener("click", openCreatePanel);

function openAuthPanel(u) {
  pendingAuthProfile = u;
  showPanel("panel-auth");
  $("#auth-avatar").innerHTML = avatarHTML(u);
  $("#auth-name").textContent = u.name;
  $("#auth-password").value = "";
  $("#auth-error").classList.add("hidden");
  setTimeout(() => $("#auth-password").focus(), 50);
}

$("#auth-back-btn").addEventListener("click", () => { pendingAuthProfile = null; renderProfilePicker(); });

async function submitAuth() {
  if (!pendingAuthProfile) return;
  const entered = $("#auth-password").value;
  const { hashB64 } = await hashPassword(entered, pendingAuthProfile.passwordSalt);
  if (hashB64 === pendingAuthProfile.passwordHash) {
    loginAsProfile(pendingAuthProfile);
  } else {
    $("#auth-error").classList.remove("hidden");
  }
}
$("#auth-btn").addEventListener("click", submitAuth);
$("#auth-password").addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });

function openCreatePanel() {
  uploadedPhoto = null;
  newProfileColorIndex = Math.floor(Math.random() * COLORS.length);
  $("#name-input").value = "";
  $("#create-password").value = "";
  $("#create-password-confirm").value = "";
  $("#create-error").classList.add("hidden");
  updateCreateAvatarPreview();
  validateCreateForm();
  showPanel("panel-create");
  setTimeout(() => $("#name-input").focus(), 50);
}
$("#create-back-btn").addEventListener("click", renderProfilePicker);

function updateCreateAvatarPreview() {
  if (uploadedPhoto) {
    $("#avatar-preview").innerHTML = `<img src="${uploadedPhoto}" />`;
    return;
  }
  const color = COLORS[newProfileColorIndex];
  const initials = initialsOf($("#name-input").value || "?");
  $("#avatar-preview").innerHTML = `<span class="initials-avatar" style="background:${color}22;color:${color}">${initials}</span>`;
}

$("#name-input").addEventListener("input", () => { updateCreateAvatarPreview(); validateCreateForm(); });
$("#create-password").addEventListener("input", validateCreateForm);
$("#create-password-confirm").addEventListener("input", validateCreateForm);

function readAndResizeImage(file, size = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$("#photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  uploadedPhoto = await readAndResizeImage(file);
  updateCreateAvatarPreview();
  validateCreateForm();
});

function validateCreateForm() {
  const name = $("#name-input").value.trim();
  const pass = $("#create-password").value;
  const confirm = $("#create-password-confirm").value;
  $("#create-btn").disabled = !(name.length > 0 && pass.length >= 4 && pass === confirm && uploadedPhoto);
}

$("#create-btn").addEventListener("click", async () => {
  const name = $("#name-input").value.trim();
  const pass = $("#create-password").value;
  const confirm = $("#create-password-confirm").value;
  if (!uploadedPhoto) { showCreateError("Sube una foto de perfil para continuar."); return; }
  if (pass.length < 4) { showCreateError("La clave debe tener al menos 4 caracteres."); return; }
  if (pass !== confirm) { showCreateError("Las claves no coinciden."); return; }

  $("#create-btn").disabled = true;
  $("#create-btn").textContent = "Creando...";
  try {
    const { saltB64, hashB64 } = await hashPassword(pass);
    const ref = await addDoc(usersCol, {
      name,
      avatarType: "photo",
      avatarValue: uploadedPhoto,
      colorIndex: newProfileColorIndex,
      passwordSalt: saltB64,
      passwordHash: hashB64,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    loginAsProfile({ id: ref.id, name, avatarType: "photo", avatarValue: uploadedPhoto, colorIndex: newProfileColorIndex });
  } catch (err) {
    showCreateError("No se pudo crear el usuario. Intenta de nuevo.");
    console.error(err);
  } finally {
    $("#create-btn").disabled = false;
    $("#create-btn").textContent = "Crear mi usuario";
  }
});

function showCreateError(msg) {
  const el = $("#create-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function loginAsProfile(profile) {
  me = { id: profile.id, name: profile.name, avatarType: profile.avatarType, avatarValue: profile.avatarValue, colorIndex: profile.colorIndex };
  localStorage.setItem("tt_active_profile_id", me.id);

  profileScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  $("#me-name").textContent = me.name;
  $("#me-avatar").innerHTML = avatarHTML(me);

  renderTeamList();
  renderAssigneeFilter();
  populateAssigneeSelect();
  startTaskListener();
}

$("#logout-btn").addEventListener("click", () => {
  localStorage.removeItem("tt_active_profile_id");
  me = null;
  appEl.classList.add("hidden");
  profileScreen.classList.remove("hidden");
  renderProfilePicker();
});

// ===================================================================
// CHANGE MY PHOTO (from the sidebar avatar)
// ===================================================================
$("#me-avatar-btn").addEventListener("click", () => $("#change-photo-input").click());

$("#change-photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !me) return;
  const dataURL = await readAndResizeImage(file);
  me.avatarType = "photo";
  me.avatarValue = dataURL;
  $("#me-avatar").innerHTML = avatarHTML(me);
  await updateDoc(doc(usersCol, me.id), {
    avatarType: "photo",
    avatarValue: dataURL,
    updatedAt: serverTimestamp()
  });
});

// ===================================================================
// TASKS LISTENER (starts once logged in)
// ===================================================================
function startTaskListener() {
  if (tasksUnsub) return;
  const q = query(tasksCol, orderBy("createdAt", "asc"));
  tasksUnsub = onSnapshot(q, (snap) => {
    tasks = [];
    snap.forEach((d) => tasks.push({ id: d.id, ...d.data() }));
    renderCurrentView();
    if (activeTaskId) {
      const t = tasks.find((x) => x.id === activeTaskId);
      if (t) fillModal(t); else closeModal();
    }
  });
}

// ===================================================================
// AVATAR / HELPERS
// ===================================================================
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return "?";
}

function avatarHTML(u) {
  if (!u) return `<span class="initials-avatar" style="background:${COLORS[0]}22;color:${COLORS[0]}">?</span>`;
  if (u.avatarType === "photo" && u.avatarValue) return `<img src="${u.avatarValue}" />`;
  const color = COLORS[(u.colorIndex ?? 0) % COLORS.length];
  return `<span class="initials-avatar" style="background:${color}22;color:${color}">${initialsOf(u.name)}</span>`;
}

function progressOf(task) {
  if (task.subtasks && task.subtasks.length > 0) {
    const done = task.subtasks.filter((s) => s.done).length;
    return Math.round((done / task.subtasks.length) * 100);
  }
  if (task.status === "done") return 100;
  if (task.status === "in-progress") return 50;
  return 0;
}

function daysBetween(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr + "T23:59:59");
  const now = new Date();
  return (due - now) / (1000 * 60 * 60); // hours
}

function fmtHours(hours) {
  if (hours === null || hours === undefined) return "Sin fecha";
  const abs = Math.abs(hours);
  if (abs < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function urgencyStatus(task) {
  if (task.status === "done") return "good";
  const h = daysBetween(task.dueDate);
  if (h === null) return "warn";
  if (h < 0) return "bad";
  if (h < 24) return "bad";
  if (h < 72) return "warn";
  return "good";
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// "YYYY-MM-DD" strings are UTC-midnight per the JS spec when parsed bare, which
// shifts them a day in negative-offset timezones. Parse as local midnight instead
// whenever we only care about the calendar day (not an exact deadline instant).
function parseLocalDate(dateStr) {
  return new Date(dateStr + "T00:00:00");
}

// ===================================================================
// SIDEBAR: TEAM + FILTER
// ===================================================================
function renderTeamList() {
  const list = $("#team-list");
  list.innerHTML = "";
  Object.values(users).forEach((u) => {
    const row = document.createElement("div");
    row.className = "team-member";
    row.innerHTML = `<span class="avatar-sm">${avatarHTML(u)}</span><span>${escapeHTML(u.name)}</span>`;
    list.appendChild(row);
  });
}

function renderAssigneeFilter() {
  const wrap = $("#assignee-filter");
  wrap.innerHTML = `<button class="chip ${assigneeFilterId === "all" ? "active" : ""}" data-assignee="all">Todos</button>`;
  Object.values(users).forEach((u) => {
    const b = document.createElement("button");
    b.className = "chip" + (assigneeFilterId === u.id ? " active" : "");
    b.dataset.assignee = u.id;
    b.textContent = u.name.split(" ")[0];
    wrap.appendChild(b);
  });
  wrap.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      assigneeFilterId = chip.dataset.assignee;
      renderAssigneeFilter();
      renderCurrentView();
    });
  });
}

function populateAssigneeSelect() {
  const sel = $("#modal-assignee");
  const current = sel.value;
  sel.innerHTML = `<option value="">Sin asignar</option>`;
  Object.values(users).forEach((u) => {
    const o = document.createElement("option");
    o.value = u.id;
    o.textContent = u.name;
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

// ===================================================================
// NAV / VIEWS
// ===================================================================
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("#view-" + currentView).classList.remove("hidden");
    $("#view-title").textContent = btn.querySelector("span").textContent;
    renderCurrentView();
  });
});

function renderCurrentView() {
  if (!me) return;
  if (currentView === "board") renderBoard();
  else if (currentView === "timeline") renderTimeline();
  else if (currentView === "hours") renderHours();
}

function filteredTasks() {
  if (assigneeFilterId === "all") return tasks;
  return tasks.filter((t) => t.assigneeId === assigneeFilterId);
}

// ===================================================================
// BOARD VIEW
// ===================================================================
function renderBoard() {
  const list = filteredTasks();
  STATUSES.forEach((status) => {
    const col = $("#col-" + status);
    const items = list.filter((t) => t.status === status);
    $("#count-" + status).textContent = items.length;
    col.innerHTML = "";
    if (items.length === 0) {
      col.innerHTML = `<div class="empty-col">Sin tareas</div>`;
      return;
    }
    items.forEach((t) => col.appendChild(taskCard(t)));
  });
}

function taskCard(t) {
  const card = document.createElement("div");
  card.className = "task-card";
  card.style.borderLeftColor = t.color || COLORS[0];
  card.draggable = true;
  card.dataset.id = t.id;

  const pct = progressOf(t);
  const assignee = users[t.assigneeId];
  const h = daysBetween(t.dueDate);
  const urgent = h !== null && h < 48 && t.status !== "done";
  const subCount = t.subtasks ? t.subtasks.length : 0;
  const subDone = t.subtasks ? t.subtasks.filter((s) => s.done).length : 0;

  card.innerHTML = `
    <div class="task-card-title">${escapeHTML(t.title || "(Sin título)")}</div>
    <div class="task-card-meta">
      <span class="task-card-due ${urgent ? "urgent" : ""}">${ICON_CALENDAR}${t.dueDate ? formatShortDate(t.dueDate) : "Sin fecha"}</span>
      ${assignee ? `<span class="avatar-sm" title="${escapeHTML(assignee.name)}">${avatarHTML(assignee)}</span>` : ""}
    </div>
    <div class="task-card-bar"><div class="task-card-bar-fill" style="width:${pct}%; background:${t.color || COLORS[0]}"></div></div>
    ${subCount > 0 ? `<div class="task-card-sub">${subDone}/${subCount} subtareas · ${pct}%</div>` : `<div class="task-card-sub">${pct}%</div>`}
  `;

  card.addEventListener("click", () => openModal(t.id));
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", t.id);
  });
  return card;
}

document.querySelectorAll(".board-col-body").forEach((col) => {
  col.addEventListener("dragover", (e) => e.preventDefault());
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const status = col.closest(".board-col").dataset.status;
    if (id) await updateDoc(doc(tasksCol, id), { status, updatedAt: serverTimestamp() });
  });
});

// ===================================================================
// TIMELINE VIEW (simplified gantt)
// ===================================================================
const CELL_W = 46;

function renderTimeline() {
  const list = filteredTasks();
  const header = $("#timeline-header");
  const body = $("#timeline-body");
  header.innerHTML = "";
  body.innerHTML = "";

  if (list.length === 0) {
    body.innerHTML = `<div class="timeline-empty">Crea una tarea con fechas de inicio y entrega para verla aquí</div>`;
    return;
  }

  const withDates = list.filter((t) => t.startDate || t.dueDate);
  const dates = [];
  withDates.forEach((t) => {
    if (t.startDate) dates.push(parseLocalDate(t.startDate));
    if (t.dueDate) dates.push(parseLocalDate(t.dueDate));
  });
  const today = parseLocalDate(todayStr());
  dates.push(today);

  let minDate = new Date(Math.min(...dates));
  let maxDate = new Date(Math.max(...dates));
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 4);

  const totalDays = Math.max(7, Math.round((maxDate - minDate) / 86400000));
  const totalWidth = totalDays * CELL_W;

  header.style.gridTemplateColumns = `220px repeat(${totalDays}, ${CELL_W}px)`;
  header.style.width = (220 + totalWidth) + "px";
  header.innerHTML = `<div class="tl-day" style="border-right:1px solid var(--border);"></div>`;

  const monthFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" });
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate);
    d.setDate(d.getDate() + i);
    const isToday = d.toDateString() === today.toDateString();
    const cell = document.createElement("div");
    cell.className = "tl-day" + (isToday ? " today" : "");
    cell.textContent = monthFmt.format(d);
    header.appendChild(cell);
  }

  list.forEach((t) => {
    const row = document.createElement("div");
    row.className = "tl-row";
    row.style.gridTemplateColumns = `220px repeat(${totalDays}, ${CELL_W}px)`;
    row.style.width = (220 + totalWidth) + "px";

    const label = document.createElement("div");
    label.className = "tl-row-label";
    label.textContent = t.title || "(Sin título)";
    row.appendChild(label);

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minDate);
      d.setDate(d.getDate() + i);
      const cell = document.createElement("div");
      cell.className = "tl-grid-cell" + (d.toDateString() === today.toDateString() ? " today" : "");
      row.appendChild(cell);
    }

    if (t.startDate || t.dueDate) {
      const start = parseLocalDate(t.startDate || t.dueDate);
      const end = parseLocalDate(t.dueDate || t.startDate);
      const offsetDays = Math.round((start - minDate) / 86400000);
      const durationDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
      const pct = progressOf(t);

      const bar = document.createElement("div");
      bar.className = "tl-bar";
      bar.style.left = (220 + offsetDays * CELL_W + 2) + "px";
      bar.style.width = (durationDays * CELL_W - 4) + "px";
      bar.style.background = (t.color || COLORS[0]);
      bar.innerHTML = `<div class="tl-bar-fill" style="width:${pct}%"></div><span>${escapeHTML(t.title || "")}</span>`;
      bar.addEventListener("click", () => openModal(t.id));
      row.appendChild(bar);
    }

    body.appendChild(row);
  });
}

// ===================================================================
// HOURS VIEW
// ===================================================================
function renderHours() {
  const list = filteredTasks().slice().sort((a, b) => {
    const ha = daysBetween(a.dueDate); const hb = daysBetween(b.dueDate);
    if (ha === null) return 1;
    if (hb === null) return -1;
    return ha - hb;
  });

  const wrap = $("#hours-list");
  wrap.innerHTML = "";
  if (list.length === 0) {
    wrap.innerHTML = `<div class="timeline-empty">No hay tareas todavía.</div>`;
    return;
  }

  list.forEach((t) => {
    const pct = progressOf(t);
    const assignee = users[t.assigneeId];
    const h = daysBetween(t.dueDate);
    const status = urgencyStatus(t);
    let bigText, lblText;
    if (t.status === "done") { bigText = `${ICON_CHECK_SMALL} Hecho`; lblText = "Completada"; }
    else if (h === null) { bigText = "—"; lblText = "Sin fecha límite"; }
    else if (h < 0) { bigText = fmtHours(h); lblText = "Atrasada"; }
    else { bigText = fmtHours(h); lblText = "Restante"; }

    const card = document.createElement("div");
    card.className = "hour-card";
    card.innerHTML = `
      <span class="hour-avatar">${avatarHTML(assignee)}</span>
      <div class="hour-main">
        <div class="hour-title">${escapeHTML(t.title || "(Sin título)")}</div>
        <div class="hour-bar-track"><div class="hour-bar-fill" style="width:${pct}%; background:${t.color || COLORS[0]}"></div></div>
      </div>
      <div class="hour-remaining status-${status}">
        <div class="big">${bigText}</div>
        <div class="lbl">${lblText} · ${pct}%</div>
      </div>
    `;
    card.addEventListener("click", () => openModal(t.id));
    wrap.appendChild(card);
  });
}

// ===================================================================
// TASK MODAL
// ===================================================================
$("#new-task-btn").addEventListener("click", async () => {
  const ref = await addDoc(tasksCol, {
    title: "",
    description: "",
    assigneeId: me.id,
    status: "todo",
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    startDate: todayStr(),
    dueDate: "",
    estimatedHours: null,
    subtasks: [],
    createdBy: me.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  openModal(ref.id);
});

function openModal(id) {
  activeTaskId = id;
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  fillModal(t);
  $("#task-modal").classList.remove("hidden");
  setTimeout(() => $("#modal-title").focus(), 50);
}

function closeModal() {
  activeTaskId = null;
  $("#task-modal").classList.add("hidden");
}
$("#modal-close").addEventListener("click", closeModal);
$("#task-modal").addEventListener("click", (e) => { if (e.target.id === "task-modal") closeModal(); });

function buildColorRow(selected) {
  const row = $("#modal-color-row");
  row.innerHTML = "";
  COLORS.forEach((c) => {
    const dot = document.createElement("div");
    dot.className = "color-dot" + (c === selected ? " selected" : "");
    dot.style.background = c;
    dot.dataset.color = c;
    dot.addEventListener("click", () => {
      row.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("selected"));
      dot.classList.add("selected");
      saveTaskFields();
    });
    row.appendChild(dot);
  });
}

// Every field auto-saves on change (same as subtasks), so nothing typed is ever
// lost if a teammate's edit triggers a realtime refresh while this modal is open.
// fillModal() skips whichever field currently has focus so it doesn't stomp on
// text the user is actively typing.
function fillModal(t) {
  const active = document.activeElement;
  if (active !== $("#modal-title")) $("#modal-title").value = t.title || "";
  if (active !== $("#modal-desc")) $("#modal-desc").value = t.description || "";
  populateAssigneeSelect();
  if (active !== $("#modal-assignee")) $("#modal-assignee").value = t.assigneeId || "";
  if (active !== $("#modal-status")) $("#modal-status").value = t.status || "todo";
  if (active !== $("#modal-start")) $("#modal-start").value = t.startDate || "";
  if (active !== $("#modal-due")) $("#modal-due").value = t.dueDate || "";
  if (active !== $("#modal-hours")) $("#modal-hours").value = t.estimatedHours ?? "";
  buildColorRow(t.color || COLORS[0]);

  const pct = progressOf(t);
  $("#modal-progress-pct").textContent = pct + "%";
  $("#modal-progress-fill").style.width = pct + "%";

  renderSubtasks(t);
}

function renderSubtasks(t) {
  const list = $("#subtasks-list");
  list.innerHTML = "";
  (t.subtasks || []).forEach((s) => {
    const row = document.createElement("div");
    row.className = "subtask-row";
    row.innerHTML = `
      <div class="subtask-check ${s.done ? "checked" : ""}" data-id="${s.id}">${s.done ? ICON_CHECK_SMALL : ""}</div>
      <div class="subtask-text ${s.done ? "done" : ""}">${escapeHTML(s.title)}</div>
      <button class="subtask-remove" data-id="${s.id}">${ICON_X_SMALL}</button>
    `;
    row.querySelector(".subtask-check").addEventListener("click", () => toggleSubtask(t.id, s.id));
    row.querySelector(".subtask-remove").addEventListener("click", () => removeSubtask(t.id, s.id));
    list.appendChild(row);
  });
}

async function toggleSubtask(taskId, subId) {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return;
  const subtasks = (t.subtasks || []).map((s) => s.id === subId ? { ...s, done: !s.done } : s);
  await updateDoc(doc(tasksCol, taskId), { subtasks, updatedAt: serverTimestamp() });
}

async function removeSubtask(taskId, subId) {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return;
  const subtasks = (t.subtasks || []).filter((s) => s.id !== subId);
  await updateDoc(doc(tasksCol, taskId), { subtasks, updatedAt: serverTimestamp() });
}

$("#subtask-input").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter" || !activeTaskId) return;
  const val = e.target.value.trim();
  if (!val) return;
  const t = tasks.find((x) => x.id === activeTaskId);
  const subtasks = [...(t.subtasks || []), { id: crypto.randomUUID(), title: val, done: false }];
  await updateDoc(doc(tasksCol, activeTaskId), { subtasks, updatedAt: serverTimestamp() });
  e.target.value = "";
});

async function saveTaskFields() {
  if (!activeTaskId) return;
  const color = $("#modal-color-row .color-dot.selected")?.dataset.color || COLORS[0];
  await updateDoc(doc(tasksCol, activeTaskId), {
    title: $("#modal-title").value.trim() || "(Sin título)",
    description: $("#modal-desc").value.trim(),
    assigneeId: $("#modal-assignee").value,
    status: $("#modal-status").value,
    startDate: $("#modal-start").value,
    dueDate: $("#modal-due").value,
    estimatedHours: $("#modal-hours").value ? Number($("#modal-hours").value) : null,
    color,
    updatedAt: serverTimestamp()
  });
}

["modal-title", "modal-desc", "modal-assignee", "modal-status", "modal-start", "modal-due", "modal-hours"]
  .forEach((id) => $("#" + id).addEventListener("change", saveTaskFields));

$("#save-task-btn").addEventListener("click", async () => {
  await saveTaskFields();
  closeModal();
});

$("#delete-task-btn").addEventListener("click", async () => {
  if (!activeTaskId) return;
  if (!confirm("¿Eliminar esta tarea? Esta acción no se puede deshacer.")) return;
  await deleteDoc(doc(tasksCol, activeTaskId));
  closeModal();
});

// ===================================================================
// UTIL
// ===================================================================
function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(d);
}
