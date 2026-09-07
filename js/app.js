import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===================================================================
// SETUP CHECK — evita que la app truene si aún no se configuró Firebase
// ===================================================================
const NEEDS_SETUP = !firebaseConfig.apiKey || firebaseConfig.apiKey === "TU_API_KEY";

if (NEEDS_SETUP) {
  document.getElementById("login-screen").innerHTML = `
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
const COLORS = ["#7c9cff", "#8fd6b4", "#ffcf86", "#ff9d9d", "#8ec9ff", "#c7aef9", "#ffb3d0", "#8fe3d6"];
const EMOJIS = ["🙂","😀","🚀","🎯","💡","🔥","🌟","🦊","🐱","🐶","🦉","🌈","🎨","☕"];
const STATUSES = ["todo", "in-progress", "done"];
const STATUS_LABEL = { "todo": "Por hacer", "in-progress": "En progreso", "done": "Hecho" };

// ===================================================================
// STATE
// ===================================================================
let me = null;           // { uid, name, avatarType, avatarValue, colorIndex }
let users = {};          // uid -> user doc
let tasks = [];          // array of task docs (with id)
let currentView = "board";
let assigneeFilterId = "all";
let activeTaskId = null; // task currently open in modal
let pendingLocalIdentity = JSON.parse(localStorage.getItem("tt_identity") || "null");
let selectedEmoji = EMOJIS[0];
let uploadedPhoto = null;

// ===================================================================
// DOM SHORTCUTS
// ===================================================================
const $ = (sel) => document.querySelector(sel);
const loginScreen = $("#login-screen");
const appEl = $("#app");

// ===================================================================
// LOGIN SCREEN SETUP
// ===================================================================
function buildEmojiRow() {
  const row = $("#emoji-row");
  row.innerHTML = "";
  EMOJIS.forEach((e) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-choice" + (e === selectedEmoji && !uploadedPhoto ? " selected" : "");
    b.textContent = e;
    b.onclick = () => {
      selectedEmoji = e;
      uploadedPhoto = null;
      $("#avatar-preview").innerHTML = e;
      buildEmojiRow();
      validateLoginForm();
    };
    row.appendChild(b);
  });
}
buildEmojiRow();
$("#avatar-preview").innerHTML = selectedEmoji;

$("#photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      uploadedPhoto = canvas.toDataURL("image/jpeg", 0.75);
      $("#avatar-preview").innerHTML = `<img src="${uploadedPhoto}" />`;
      buildEmojiRow();
      validateLoginForm();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

$("#name-input").addEventListener("input", validateLoginForm);
function validateLoginForm() {
  $("#login-btn").disabled = $("#name-input").value.trim().length === 0;
}

$("#login-btn").addEventListener("click", async () => {
  const name = $("#name-input").value.trim();
  if (!name) return;
  $("#login-btn").disabled = true;
  $("#login-btn").textContent = "Entrando...";
  const identity = {
    name,
    avatarType: uploadedPhoto ? "photo" : "emoji",
    avatarValue: uploadedPhoto || selectedEmoji,
    colorIndex: Math.floor(Math.random() * COLORS.length)
  };
  localStorage.setItem("tt_identity", JSON.stringify(identity));
  pendingLocalIdentity = identity;
  await ensureSignedIn();
});

// ===================================================================
// AUTH
// ===================================================================
function ensureSignedIn() {
  return signInAnonymously(auth).catch((err) => {
    alert("No se pudo conectar con Firebase. Revisa tu configuración y las reglas de Authentication.\n\n" + err.message);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const identity = pendingLocalIdentity || JSON.parse(localStorage.getItem("tt_identity") || "null");
  if (!identity) return; // still on login screen, waiting for the user to submit the form

  me = { uid: user.uid, ...identity };
  await setDoc(doc(usersCol, user.uid), {
    name: identity.name,
    avatarType: identity.avatarType,
    avatarValue: identity.avatarValue,
    colorIndex: identity.colorIndex,
    updatedAt: serverTimestamp()
  }, { merge: true });

  loginScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  $("#me-name").textContent = me.name;
  $("#me-avatar").innerHTML = avatarHTML(me);

  startListeners();
});

// If a previous session identity exists, auto sign-in silently on load.
if (pendingLocalIdentity) {
  ensureSignedIn();
}

$("#logout-btn").addEventListener("click", () => {
  localStorage.removeItem("tt_identity");
  location.reload();
});

// ===================================================================
// REALTIME LISTENERS
// ===================================================================
function startListeners() {
  onSnapshot(usersCol, (snap) => {
    users = {};
    snap.forEach((d) => { users[d.id] = { id: d.id, ...d.data() }; });
    renderTeamList();
    renderAssigneeFilter();
    populateAssigneeSelect();
    renderCurrentView();
  });

  const q = query(tasksCol, orderBy("createdAt", "asc"));
  onSnapshot(q, (snap) => {
    tasks = [];
    snap.forEach((d) => tasks.push({ id: d.id, ...d.data() }));
    flashSync();
    renderCurrentView();
    if (activeTaskId) {
      const t = tasks.find((x) => x.id === activeTaskId);
      if (t) fillModal(t); else closeModal();
    }
  });
}

function flashSync() {
  const el = $("#sync-indicator");
  el.textContent = "🟢 Sincronizado";
}

// ===================================================================
// AVATAR / HELPERS
// ===================================================================
function avatarHTML(u) {
  if (!u) return "🙂";
  if (u.avatarType === "photo" && u.avatarValue) return `<img src="${u.avatarValue}" />`;
  return u.avatarValue || "🙂";
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
    $("#view-title").textContent = btn.textContent.trim().replace(/^\S+\s/, "");
    renderCurrentView();
  });
});

function renderCurrentView() {
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
      <span class="task-card-due ${urgent ? "urgent" : ""}">📅 ${t.dueDate ? formatShortDate(t.dueDate) : "Sin fecha"}</span>
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
    body.innerHTML = `<div class="timeline-empty">Crea una tarea con fechas de inicio y entrega para verla aquí ✨</div>`;
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
    if (t.status === "done") { bigText = "✓ Hecho"; lblText = "Completada"; }
    else if (h === null) { bigText = "—"; lblText = "Sin fecha límite"; }
    else if (h < 0) { bigText = fmtHours(h); lblText = "Atrasada"; }
    else { bigText = fmtHours(h); lblText = "Restante"; }

    const card = document.createElement("div");
    card.className = "hour-card";
    card.innerHTML = `
      <span class="hour-avatar">${assignee ? avatarHTML(assignee) : "👤"}</span>
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
    assigneeId: me.uid,
    status: "todo",
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    startDate: todayStr(),
    dueDate: "",
    estimatedHours: null,
    subtasks: [],
    createdBy: me.uid,
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

let modalColorRowBuilt = false;
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
      <div class="subtask-check ${s.done ? "checked" : ""}" data-id="${s.id}">${s.done ? "✓" : ""}</div>
      <div class="subtask-text ${s.done ? "done" : ""}">${escapeHTML(s.title)}</div>
      <button class="subtask-remove" data-id="${s.id}">✕</button>
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
