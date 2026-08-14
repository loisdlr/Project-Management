const STORAGE_KEY = "dualflow-trello-v2";
const STATUSES = ["To Do", "In Progress", "Review", "Done"];

const demoData = {
  users: [
    { id: "u1", name: "User 1" },
    { id: "u2", name: "User 2" }
  ],
  currentUserId: "u1",
  projects: [
    {
      id: "p1",
      name: "Website Launch",
      description: "Plan, build, review and launch the new website.",
      due: "2026-08-30"
    },
    {
      id: "p2",
      name: "Client Operations",
      description: "Ongoing admin, coordination and client deliverables.",
      due: "2026-09-15"
    }
  ],
  tasks: [
    {
      id: "t1",
      name: "Finalize homepage content",
      projectId: "p1",
      assigneeId: "u1",
      status: "In Progress",
      priority: "High",
      due: "2026-08-15",
      notes: "Review headline, CTA and service sections.",
      checklist: [
        { text: "Review headline", done: true },
        { text: "Check CTA", done: false },
        { text: "Proofread service copy", done: false }
      ]
    },
    {
      id: "t2",
      name: "QA mobile layout",
      projectId: "p1",
      assigneeId: "u2",
      status: "To Do",
      priority: "Medium",
      due: "2026-08-18",
      notes: "Check phone and tablet breakpoints.",
      checklist: [
        { text: "iPhone layout", done: false },
        { text: "Android layout", done: false }
      ]
    },
    {
      id: "t3",
      name: "Prepare weekly client report",
      projectId: "p2",
      assigneeId: "u1",
      status: "Review",
      priority: "Medium",
      due: "2026-08-13",
      notes: "Include progress, blockers and next actions.",
      checklist: [
        { text: "Progress summary", done: true },
        { text: "Add blockers", done: true },
        { text: "Final review", done: false }
      ]
    },
    {
      id: "t4",
      name: "Archive completed files",
      projectId: "p2",
      assigneeId: "u2",
      status: "Done",
      priority: "Low",
      due: "2026-08-10",
      notes: "",
      checklist: [
        { text: "Move files", done: true },
        { text: "Update folder names", done: true }
      ]
    }
  ]
};

let state = loadState();
let draggedTaskId = null;

const $ = id => document.getElementById(id);
const uid = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : structuredClone(demoData);
  } catch {
    return structuredClone(demoData);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getUser(id){ return state.users.find(u => u.id === id); }
function getProject(id){ return state.projects.find(p => p.id === id); }

function initials(name) {
  return (name || "?").split(/\s+/).map(part => part[0]).join("").slice(0,2).toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return "No due date";
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    month:"short", day:"numeric"
  });
}

function isOverdue(task) {
  if (!task.due || task.status === "Done") return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  return new Date(task.due + "T00:00:00") < today;
}

function renderAll() {
  renderToday();
  renderTeam();
  renderUserSelect();
  renderSelectOptions();
  renderBoard();
  renderProjects();
}

function renderToday() {
  $("todayText").textContent = new Date().toLocaleDateString(undefined, {
    weekday:"long", month:"long", day:"numeric", year:"numeric"
  });
}

function renderTeam() {
  $("teamList").innerHTML = state.users.map(user => `
    <div class="team-member">
      <div class="avatar">${initials(user.name)}</div>
      <span>${escapeHtml(user.name)}</span>
    </div>
  `).join("");
}

function renderUserSelect() {
  $("currentUserSelect").innerHTML = state.users.map(user =>
    `<option value="${user.id}" ${user.id === state.currentUserId ? "selected":""}>
      Viewing: ${escapeHtml(user.name)}
    </option>`
  ).join("");
}

function renderSelectOptions() {
  const projectValue = $("filterProject").value;
  const assigneeValue = $("filterAssignee").value;
  const priorityValue = $("filterPriority").value;

  const projectOptions = state.projects.map(p =>
    `<option value="${p.id}">${escapeHtml(p.name)}</option>`
  ).join("");

  const userOptions = state.users.map(u =>
    `<option value="${u.id}">${escapeHtml(u.name)}</option>`
  ).join("");

  $("taskProject").innerHTML = projectOptions || `<option value="">No projects available</option>`;
  $("taskAssignee").innerHTML = userOptions;
  $("filterProject").innerHTML = `<option value="">All projects</option>${projectOptions}`;
  $("filterAssignee").innerHTML = `<option value="">All assignees</option>${userOptions}`;

  if ([...$("filterProject").options].some(o => o.value === projectValue)) $("filterProject").value = projectValue;
  if ([...$("filterAssignee").options].some(o => o.value === assigneeValue)) $("filterAssignee").value = assigneeValue;
  $("filterPriority").value = priorityValue;
}

function getFilteredTasks() {
  const q = $("taskSearch").value.trim().toLowerCase();
  const projectId = $("filterProject").value;
  const assigneeId = $("filterAssignee").value;
  const priority = $("filterPriority").value;

  return state.tasks.filter(task => {
    const project = getProject(task.projectId)?.name || "";
    const assignee = getUser(task.assigneeId)?.name || "";
    const matchesSearch = !q || [task.name, task.notes, project, assignee, task.priority, task.status]
      .some(v => (v || "").toLowerCase().includes(q));

    return matchesSearch &&
      (!projectId || task.projectId === projectId) &&
      (!assigneeId || task.assigneeId === assigneeId) &&
      (!priority || task.priority === priority);
  });
}

function renderBoard() {
  const tasks = getFilteredTasks();
  const overdueCount = tasks.filter(isOverdue).length;
  const doneCount = tasks.filter(t => t.status === "Done").length;

  $("boardStats").innerHTML = `
    <span class="mini-stat">${tasks.length} cards</span>
    <span class="mini-stat">${doneCount} completed</span>
    <span class="mini-stat">${overdueCount} overdue</span>
  `;

  $("kanbanBoard").innerHTML = STATUSES.map(status => {
    const statusTasks = tasks.filter(task => task.status === status);

    return `
      <section class="kanban-column" data-status="${status}">
        <div class="column-header">
          <div class="column-title">
            <h4>${status}</h4>
            <span class="column-count">${statusTasks.length}</span>
          </div>
          <button class="add-card-inline" type="button" data-add-status="${status}">+ Add</button>
        </div>
        <div class="card-stack" data-drop-status="${status}">
          ${statusTasks.length ? statusTasks.map(renderTaskCard).join("") :
            `<div class="empty-column">Drop cards here</div>`}
        </div>
      </section>
    `;
  }).join("");

  wireBoardEvents();
}

function renderTaskCard(task) {
  const project = getProject(task.projectId);
  const user = getUser(task.assigneeId);
  const checklist = task.checklist || [];
  const doneItems = checklist.filter(item => item.done).length;
  const pct = checklist.length ? Math.round(doneItems / checklist.length * 100) : 0;

  return `
    <article class="trello-card" draggable="true" data-task-id="${task.id}">
      <div class="card-labels">
        <span class="card-label label-project">${escapeHtml(project?.name || "No project")}</span>
        <span class="card-label label-${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
      </div>
      <div class="card-title">${escapeHtml(task.name)}</div>
      ${task.notes ? `<div class="card-description">${escapeHtml(task.notes)}</div>` : ""}
      <div class="card-footer">
        <div class="card-meta">
          ${task.due ? `<span class="meta-chip ${isOverdue(task) ? "overdue" : ""}">◷ ${formatDate(task.due)}</span>` : ""}
          ${checklist.length ? `<span class="meta-chip">✓ ${doneItems}/${checklist.length}</span>` : ""}
        </div>
        <div class="card-assignee" title="${escapeHtml(user?.name || "")}">
          ${initials(user?.name)}
        </div>
      </div>
      ${checklist.length ? `
        <div class="card-progress">
          <span class="check-text">${pct}%</span>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>` : ""}
    </article>
  `;
}

function wireBoardEvents() {
  document.querySelectorAll(".trello-card").forEach(card => {
    card.addEventListener("click", () => openTask(card.dataset.taskId));
    card.addEventListener("dragstart", event => {
      draggedTaskId = card.dataset.taskId;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedTaskId);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggedTaskId = null;
      document.querySelectorAll(".kanban-column").forEach(col => col.classList.remove("drag-over"));
    });
  });

  document.querySelectorAll(".kanban-column").forEach(column => {
    column.addEventListener("dragover", event => {
      event.preventDefault();
      column.classList.add("drag-over");
    });
    column.addEventListener("dragleave", event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
    });
    column.addEventListener("drop", event => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const taskId = draggedTaskId || event.dataTransfer.getData("text/plain");
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      task.status = column.dataset.status;
      saveState();
      renderBoard();
      renderProjects();
    });
  });

  document.querySelectorAll("[data-add-status]").forEach(button => {
    button.addEventListener("click", () => openTask("", button.dataset.addStatus));
  });
}

function renderProjects() {
  $("projectsGrid").innerHTML = state.projects.length ? state.projects.map(project => {
    const tasks = state.tasks.filter(t => t.projectId === project.id);
    const completed = tasks.filter(t => t.status === "Done").length;
    const pct = tasks.length ? Math.round(completed / tasks.length * 100) : 0;

    return `
      <article class="project-card">
        <h3>${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.description || "No description.")}</p>
        <div class="project-progress"><div style="width:${pct}%"></div></div>
        <div class="project-footer">
          <span>${completed}/${tasks.length} complete</span>
          <span>${project.due ? "Due " + formatDate(project.due) : "No due date"}</span>
        </div>
        <div class="project-actions">
          <button class="secondary-btn edit-project" type="button" data-project-id="${project.id}">Edit</button>
          <button class="ghost-btn view-project-board" type="button" data-project-id="${project.id}">Open Board</button>
        </div>
      </article>
    `;
  }).join("") : `<div class="empty-state">No projects created yet.</div>`;

  document.querySelectorAll(".edit-project").forEach(btn => {
    btn.addEventListener("click", () => openProject(btn.dataset.projectId));
  });

  document.querySelectorAll(".view-project-board").forEach(btn => {
    btn.addEventListener("click", () => {
      switchView("board");
      $("filterProject").value = btn.dataset.projectId;
      renderBoard();
    });
  });
}

function openTask(id = "", presetStatus = "To Do") {
  $("taskForm").reset();
  $("taskId").value = "";
  $("taskModalTitle").textContent = "New Card";
  $("deleteTaskBtn").classList.add("hidden");
  $("taskStatus").value = presetStatus;
  $("taskPriority").value = "Medium";
  $("taskAssignee").value = state.currentUserId;
  $("taskStatusTop").textContent = presetStatus.toUpperCase();

  if (id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    $("taskId").value = task.id;
    $("taskName").value = task.name;
    $("taskProject").value = task.projectId;
    $("taskAssignee").value = task.assigneeId;
    $("taskStatus").value = task.status;
    $("taskPriority").value = task.priority;
    $("taskDue").value = task.due || "";
    $("taskNotes").value = task.notes || "";
    $("taskChecklist").value = (task.checklist || []).map(item => `${item.done ? "[x]" : "[ ]"} ${item.text}`).join("\n");
    $("taskModalTitle").textContent = "Edit Card";
    $("taskStatusTop").textContent = task.status.toUpperCase();
    $("deleteTaskBtn").classList.remove("hidden");
  } else if (state.projects[0]) {
    $("taskProject").value = $("filterProject").value || state.projects[0].id;
  }

  $("taskDialog").showModal();
}

function parseChecklist(text, oldChecklist = []) {
  return text.split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const checked = /^\[(x|X)\]\s*/.test(line);
      const unchecked = /^\[\s\]\s*/.test(line);
      const clean = line.replace(/^\[(x|X|\s)\]\s*/, "").trim();
      const previous = oldChecklist.find(item => item.text === clean);
      return {
        text: clean,
        done: checked ? true : unchecked ? false : (previous?.done || false)
      };
    });
}

function openProject(id = "") {
  $("projectForm").reset();
  $("projectId").value = "";
  $("projectModalTitle").textContent = "New Project";
  $("deleteProjectBtn").classList.add("hidden");

  if (id) {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;
    $("projectId").value = project.id;
    $("projectName").value = project.name;
    $("projectDescription").value = project.description || "";
    $("projectDue").value = project.due || "";
    $("projectModalTitle").textContent = "Edit Project";
    $("deleteProjectBtn").classList.remove("hidden");
  }

  $("projectDialog").showModal();
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(v => v.classList.remove("active"));
  $(`${view}View`).classList.add("active");
  document.querySelector(`.nav-btn[data-view="${view}"]`)?.classList.add("active");
  $("pageTitle").textContent = view === "board" ? "Project Board" : "Projects";
}

$("taskForm").addEventListener("submit", event => {
  event.preventDefault();
  const id = $("taskId").value;
  const existing = state.tasks.find(t => t.id === id);

  const task = {
    id: id || uid("t"),
    name: $("taskName").value.trim(),
    projectId: $("taskProject").value,
    assigneeId: $("taskAssignee").value,
    status: $("taskStatus").value,
    priority: $("taskPriority").value,
    due: $("taskDue").value,
    notes: $("taskNotes").value.trim(),
    checklist: parseChecklist($("taskChecklist").value, existing?.checklist || [])
  };

  if (!task.name || !task.projectId || !task.assigneeId) return;

  if (id) {
    const index = state.tasks.findIndex(t => t.id === id);
    state.tasks[index] = task;
  } else {
    state.tasks.push(task);
  }

  saveState();
  $("taskDialog").close();
  renderAll();
});

$("projectForm").addEventListener("submit", event => {
  event.preventDefault();
  const id = $("projectId").value;
  const project = {
    id: id || uid("p"),
    name: $("projectName").value.trim(),
    description: $("projectDescription").value.trim(),
    due: $("projectDue").value
  };

  if (!project.name) return;

  if (id) {
    const index = state.projects.findIndex(p => p.id === id);
    state.projects[index] = project;
  } else {
    state.projects.push(project);
  }

  saveState();
  $("projectDialog").close();
  renderAll();
});

$("deleteTaskBtn").addEventListener("click", () => {
  const id = $("taskId").value;
  if (!id) return;
  if (confirm("Delete this card?")) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveState();
    $("taskDialog").close();
    renderAll();
  }
});

$("deleteProjectBtn").addEventListener("click", () => {
  const id = $("projectId").value;
  if (!id) return;
  const linkedTasks = state.tasks.filter(t => t.projectId === id).length;
  const message = linkedTasks
    ? `This project has ${linkedTasks} card(s). Delete the project and all its cards?`
    : "Delete this project?";

  if (confirm(message)) {
    state.projects = state.projects.filter(p => p.id !== id);
    state.tasks = state.tasks.filter(t => t.projectId !== id);
    saveState();
    $("projectDialog").close();
    renderAll();
  }
});

$("currentUserSelect").addEventListener("change", event => {
  state.currentUserId = event.target.value;
  saveState();
  renderAll();
});

["taskSearch","filterProject","filterAssignee","filterPriority"].forEach(id => {
  $(id).addEventListener("input", renderBoard);
  $(id).addEventListener("change", renderBoard);
});

$("newTaskBtn").addEventListener("click", () => {
  if (!state.projects.length) return alert("Create a project first.");
  openTask();
});

$("newProjectBtn").addEventListener("click", () => openProject());

$("taskStatus").addEventListener("change", () => {
  $("taskStatusTop").textContent = $("taskStatus").value.toUpperCase();
});

$("resetDemo").addEventListener("click", () => {
  if (confirm("Reset everything back to the original demo board?")) {
    state = structuredClone(demoData);
    saveState();
    renderAll();
  }
});

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => $(button.dataset.close).close());
});

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

renderAll();
