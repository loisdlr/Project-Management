import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const STATUSES = ["To Do", "In Progress", "Review", "Done"];
const $ = id => document.getElementById(id);

const cfg = window.DUALFLOW_CONFIG || {};
const configured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_PUBLISHABLE_KEY &&
  !cfg.SUPABASE_URL.includes("PASTE_") &&
  !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");

let supabase = null;
let session = null;
let profile = null;
let team = null;
let members = [];
let projects = [];
let tasks = [];
let checklistItems = [];
let realtimeChannel = null;
let draggedTaskId = null;
let checklistDraft = [];
let reloadTimer = null;

function showOnly(id) {
  ["configScreen", "authScreen", "workspaceScreen", "appShell"].forEach(x => $(x).classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function initials(name) {
  return (name || "?").split(/\s+/).map(x => x[0]).join("").slice(0,2).toUpperCase();
}

function showMessage(el, text, type = "") {
  el.textContent = text;
  el.className = `message ${type}`.trim();
}

function clearMessage(el) {
  el.textContent = "";
  el.className = "message hidden";
}

function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 1800);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {month:"short", day:"numeric"});
}

function overdue(task) {
  if (!task.due_date || task.status === "Done") return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(task.due_date + "T00:00:00") < today;
}

function memberProfile(id) {
  return members.find(m => m.user_id === id)?.profiles || null;
}

function projectById(id) {
  return projects.find(p => p.id === id);
}

function checklistForTask(taskId) {
  return checklistItems.filter(i => i.task_id === taskId).sort((a,b) => a.position - b.position);
}

async function init() {
  if (!configured) {
    showOnly("configScreen");
    return;
  }

  supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

  const { data } = await supabase.auth.getSession();
  session = data.session;

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
    setTimeout(route, 0);
  });

  await route();
}

async function route() {
  if (!session?.user) {
    cleanupRealtime();
    showOnly("authScreen");
    return;
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id,display_name")
    .eq("id", session.user.id)
    .maybeSingle();

  profile = profileData || { id: session.user.id, display_name: session.user.user_metadata?.display_name || "User" };

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id,role")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!membership) {
    cleanupRealtime();
    showOnly("workspaceScreen");
    return;
  }

  const { data: teamData, error } = await supabase
    .from("teams")
    .select("id,name,invite_code,created_by")
    .eq("id", membership.team_id)
    .single();

  if (error) {
    console.error(error);
    return;
  }

  team = teamData;
  showOnly("appShell");
  await reloadData();
  setupRealtime();
}

async function reloadData() {
  if (!team) return;

  const [membersRes, projectsRes, tasksRes, checksRes] = await Promise.all([
    supabase.from("team_members")
      .select("user_id,role,profiles(id,display_name)")
      .eq("team_id", team.id)
      .order("joined_at"),
    supabase.from("projects")
      .select("*")
      .eq("team_id", team.id)
      .order("created_at"),
    supabase.from("tasks")
      .select("*")
      .eq("team_id", team.id)
      .order("created_at"),
    supabase.from("checklist_items")
      .select("*")
      .eq("team_id", team.id)
      .order("position")
  ]);

  const firstError = [membersRes, projectsRes, tasksRes, checksRes].find(r => r.error)?.error;
  if (firstError) {
    console.error(firstError);
    toast("Could not refresh data.");
    return;
  }

  members = membersRes.data || [];
  projects = projectsRes.data || [];
  tasks = tasksRes.data || [];
  checklistItems = checksRes.data || [];

  renderAll();
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadData, 120);
}

function setupRealtime() {
  cleanupRealtime();
  if (!team) return;

  realtimeChannel = supabase
    .channel(`dualflow-${team.id}`)
    .on("postgres_changes", {event:"*", schema:"public", table:"projects", filter:`team_id=eq.${team.id}`}, scheduleReload)
    .on("postgres_changes", {event:"*", schema:"public", table:"tasks", filter:`team_id=eq.${team.id}`}, scheduleReload)
    .on("postgres_changes", {event:"*", schema:"public", table:"checklist_items", filter:`team_id=eq.${team.id}`}, scheduleReload)
    .on("postgres_changes", {event:"*", schema:"public", table:"team_members", filter:`team_id=eq.${team.id}`}, scheduleReload)
    .subscribe();
}

function cleanupRealtime() {
  if (supabase && realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function renderAll() {
  $("workspaceNameLabel").textContent = team.name;
  $("signedInAs").textContent = `Signed in as ${profile.display_name}`;
  $("inviteCodeLabel").textContent = team.invite_code;
  $("profileName").value = profile.display_name;

  renderTeam();
  renderFilters();
  renderBoard();
  renderProjects();
}

function renderTeam() {
  $("teamList").innerHTML = members.map(m => {
    const p = m.profiles || {display_name:"User"};
    return `<div class="team-member ${m.user_id === session.user.id ? "current" : ""}">
      <div class="avatar">${initials(p.display_name)}</div>
      <span>${escapeHtml(p.display_name)}</span>
    </div>`;
  }).join("");
}

function renderFilters() {
  const pf = $("projectFilter").value;
  const af = $("assigneeFilter").value;

  $("projectFilter").innerHTML =
    `<option value="">All projects</option>` +
    projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  $("assigneeFilter").innerHTML =
    `<option value="">All assignees</option>` +
    members.map(m => `<option value="${m.user_id}">${escapeHtml(m.profiles?.display_name || "User")}</option>`).join("");

  $("taskProjectInput").innerHTML =
    projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  $("taskAssigneeInput").innerHTML =
    members.map(m => `<option value="${m.user_id}">${escapeHtml(m.profiles?.display_name || "User")}</option>`).join("");

  if ([...$("projectFilter").options].some(o => o.value === pf)) $("projectFilter").value = pf;
  if ([...$("assigneeFilter").options].some(o => o.value === af)) $("assigneeFilter").value = af;
}

function filteredTasks() {
  const q = $("searchInput").value.trim().toLowerCase();
  const projectId = $("projectFilter").value;
  const assigneeId = $("assigneeFilter").value;
  const priority = $("priorityFilter").value;

  return tasks.filter(t => {
    const text = [
      t.title, t.description, t.status, t.priority,
      projectById(t.project_id)?.name,
      memberProfile(t.assignee_id)?.display_name
    ].join(" ").toLowerCase();

    return (!q || text.includes(q)) &&
      (!projectId || t.project_id === projectId) &&
      (!assigneeId || t.assignee_id === assigneeId) &&
      (!priority || t.priority === priority);
  });
}

function renderBoard() {
  const visible = filteredTasks();
  $("boardStats").innerHTML = `
    <span class="stat-chip">${visible.length} cards</span>
    <span class="stat-chip">${visible.filter(t => t.status === "Done").length} completed</span>
    <span class="stat-chip">${visible.filter(overdue).length} overdue</span>
    <span class="stat-chip">${members.length}/2 users</span>
  `;

  $("kanbanBoard").innerHTML = STATUSES.map(status => {
    const list = visible.filter(t => t.status === status);
    return `<section class="kanban-column" data-status="${status}">
      <div class="column-head">
        <div class="column-title"><h3>${status}</h3><span class="count">${list.length}</span></div>
        <button class="add-inline" data-add-status="${status}" type="button">+ Add</button>
      </div>
      <div class="card-stack">
        ${list.length ? list.map(renderCard).join("") :
          `<div class="empty-column">${projects.length ? "Drop cards here" : "Create a project first"}</div>`}
      </div>
    </section>`;
  }).join("");

  wireBoard();
}

function renderCard(task) {
  const project = projectById(task.project_id);
  const person = memberProfile(task.assignee_id);
  const checks = checklistForTask(task.id);
  const done = checks.filter(c => c.is_done).length;
  const pct = checks.length ? Math.round(done / checks.length * 100) : 0;

  return `<article class="trello-card" draggable="true" data-task-id="${task.id}">
    <div class="card-labels">
      <span class="card-label label-project">${escapeHtml(project?.name || "No project")}</span>
      <span class="card-label label-${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
    </div>
    <div class="card-title">${escapeHtml(task.title)}</div>
    ${task.description ? `<div class="card-desc">${escapeHtml(task.description)}</div>` : ""}
    <div class="card-footer">
      <div class="card-meta">
        ${task.due_date ? `<span class="meta-chip ${overdue(task) ? "overdue" : ""}">◷ ${formatDate(task.due_date)}</span>` : ""}
        ${checks.length ? `<span class="meta-chip">✓ ${done}/${checks.length}</span>` : ""}
      </div>
      <div class="card-assignee" title="${escapeHtml(person?.display_name || "")}">${initials(person?.display_name)}</div>
    </div>
    ${checks.length ? `<div class="card-progress">
      <span class="progress-text">${pct}%</span>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>` : ""}
  </article>`;
}

function wireBoard() {
  document.querySelectorAll(".trello-card").forEach(card => {
    card.addEventListener("click", () => openTask(card.dataset.taskId));
    card.addEventListener("dragstart", e => {
      draggedTaskId = card.dataset.taskId;
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", draggedTaskId);
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggedTaskId = null;
      document.querySelectorAll(".kanban-column").forEach(c => c.classList.remove("drag-over"));
    });
  });

  document.querySelectorAll(".kanban-column").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave", e => { if (!col.contains(e.relatedTarget)) col.classList.remove("drag-over"); });
    col.addEventListener("drop", async e => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const taskId = draggedTaskId || e.dataTransfer.getData("text/plain");
      if (!taskId) return;
      const { error } = await supabase.from("tasks").update({status: col.dataset.status}).eq("id", taskId);
      if (error) toast(error.message); else scheduleReload();
    });
  });

  document.querySelectorAll("[data-add-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!projects.length) return openProject();
      openTask("", btn.dataset.addStatus);
    });
  });
}

function renderProjects() {
  if (!projects.length) {
    $("projectsGrid").innerHTML = `<div class="empty-state">No projects yet.<br><br>Click <strong>+ Project</strong> to create your first shared project.</div>`;
    return;
  }

  $("projectsGrid").innerHTML = projects.map(p => {
    const list = tasks.filter(t => t.project_id === p.id);
    const done = list.filter(t => t.status === "Done").length;
    const pct = list.length ? Math.round(done / list.length * 100) : 0;
    return `<article class="project-card">
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.description || "No description.")}</p>
      <div class="project-progress"><div style="width:${pct}%"></div></div>
      <div class="project-footer"><span>${done}/${list.length} complete</span><span>${p.due_date ? "Due " + formatDate(p.due_date) : "No due date"}</span></div>
      <div class="project-actions">
        <button class="secondary-btn edit-project" data-project-id="${p.id}" type="button">Edit</button>
        <button class="secondary-btn open-project-board" data-project-id="${p.id}" type="button">Open Board</button>
      </div>
    </article>`;
  }).join("");

  document.querySelectorAll(".edit-project").forEach(btn => btn.addEventListener("click", () => openProject(btn.dataset.projectId)));
  document.querySelectorAll(".open-project-board").forEach(btn => btn.addEventListener("click", () => {
    switchView("board");
    $("projectFilter").value = btn.dataset.projectId;
    renderBoard();
  }));
}

function openProject(id = "") {
  $("projectForm").reset();
  $("projectId").value = "";
  $("projectDialogTitle").textContent = "New Project";
  $("deleteProjectBtn").classList.add("hidden");

  if (id) {
    const p = projectById(id);
    if (!p) return;
    $("projectId").value = p.id;
    $("projectNameInput").value = p.name;
    $("projectDescriptionInput").value = p.description || "";
    $("projectDueInput").value = p.due_date || "";
    $("projectDialogTitle").textContent = "Edit Project";
    $("deleteProjectBtn").classList.remove("hidden");
  }
  $("projectDialog").showModal();
}

function openTask(id = "", presetStatus = "To Do") {
  if (!projects.length) {
    toast("Create a project first.");
    return openProject();
  }

  $("taskForm").reset();
  $("taskId").value = "";
  $("taskDialogTitle").textContent = "New Card";
  $("deleteTaskBtn").classList.add("hidden");
  $("taskStatusInput").value = presetStatus;
  $("taskPriorityInput").value = "Medium";
  $("taskStatusLabel").textContent = presetStatus.toUpperCase();
  $("taskProjectInput").value = $("projectFilter").value || projects[0].id;
  $("taskAssigneeInput").value = session.user.id;
  checklistDraft = [];

  if (id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    $("taskId").value = t.id;
    $("taskTitleInput").value = t.title;
    $("taskProjectInput").value = t.project_id;
    $("taskAssigneeInput").value = t.assignee_id;
    $("taskStatusInput").value = t.status;
    $("taskPriorityInput").value = t.priority;
    $("taskDueInput").value = t.due_date || "";
    $("taskDescriptionInput").value = t.description || "";
    $("taskDialogTitle").textContent = "Edit Card";
    $("taskStatusLabel").textContent = t.status.toUpperCase();
    $("deleteTaskBtn").classList.remove("hidden");
    checklistDraft = checklistForTask(t.id).map(x => ({id:x.id, text:x.text, is_done:x.is_done}));
  }

  renderChecklistEditor();
  $("taskDialog").showModal();
}

function renderChecklistEditor() {
  if (!checklistDraft.length) {
    $("checklistEditor").innerHTML = `<div class="empty-column">No checklist items</div>`;
    return;
  }

  $("checklistEditor").innerHTML = checklistDraft.map((item, i) => `<div class="check-row">
    <input type="checkbox" data-check-done="${i}" ${item.is_done ? "checked" : ""}>
    <input type="text" data-check-text="${i}" value="${escapeHtml(item.text)}" placeholder="Checklist item">
    <button class="remove-check" data-check-remove="${i}" type="button">×</button>
  </div>`).join("");

  document.querySelectorAll("[data-check-done]").forEach(x => x.addEventListener("change", () => checklistDraft[Number(x.dataset.checkDone)].is_done = x.checked));
  document.querySelectorAll("[data-check-text]").forEach(x => x.addEventListener("input", () => checklistDraft[Number(x.dataset.checkText)].text = x.value));
  document.querySelectorAll("[data-check-remove]").forEach(x => x.addEventListener("click", () => {
    checklistDraft.splice(Number(x.dataset.checkRemove), 1);
    renderChecklistEditor();
  }));
}

async function saveChecklist(taskId) {
  const { error: delError } = await supabase.from("checklist_items").delete().eq("task_id", taskId);
  if (delError) throw delError;

  const rows = checklistDraft
    .map((x,i) => ({team_id:team.id, task_id:taskId, text:(x.text || "").trim(), is_done:!!x.is_done, position:i}))
    .filter(x => x.text);

  if (rows.length) {
    const { error } = await supabase.from("checklist_items").insert(rows);
    if (error) throw error;
  }
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(v => v.classList.remove("active"));
  $(`${view}View`).classList.add("active");
  document.querySelector(`.nav-btn[data-view="${view}"]`)?.classList.add("active");
  $("pageTitle").textContent = view === "board" ? "Project Board" : view === "projects" ? "Projects" : "Settings";
}

$("signInTab").addEventListener("click", () => {
  $("signInTab").classList.add("active"); $("signUpTab").classList.remove("active");
  $("signInForm").classList.remove("hidden"); $("signUpForm").classList.add("hidden"); clearMessage($("authMessage"));
});
$("signUpTab").addEventListener("click", () => {
  $("signUpTab").classList.add("active"); $("signInTab").classList.remove("active");
  $("signUpForm").classList.remove("hidden"); $("signInForm").classList.add("hidden"); clearMessage($("authMessage"));
});

$("signInForm").addEventListener("submit", async e => {
  e.preventDefault(); clearMessage($("authMessage"));
  const { error } = await supabase.auth.signInWithPassword({
    email:$("signInEmail").value.trim(),
    password:$("signInPassword").value
  });
  if (error) showMessage($("authMessage"), error.message, "error");
});

$("signUpForm").addEventListener("submit", async e => {
  e.preventDefault(); clearMessage($("authMessage"));
  const { data, error } = await supabase.auth.signUp({
    email:$("signUpEmail").value.trim(),
    password:$("signUpPassword").value,
    options:{data:{display_name:$("signUpName").value.trim()}}
  });
  if (error) return showMessage($("authMessage"), error.message, "error");
  if (!data.session) showMessage($("authMessage"), "Account created. Check your email to confirm it, then sign in.", "success");
  else showMessage($("authMessage"), "Account created.", "success");
});

$("createWorkspaceForm").addEventListener("submit", async e => {
  e.preventDefault(); clearMessage($("workspaceMessage"));
  const { error } = await supabase.rpc("create_team", {team_name:$("workspaceName").value.trim()});
  if (error) return showMessage($("workspaceMessage"), error.message, "error");
  await route();
});

$("joinWorkspaceForm").addEventListener("submit", async e => {
  e.preventDefault(); clearMessage($("workspaceMessage"));
  const { error } = await supabase.rpc("join_team_by_code", {code:$("inviteCodeInput").value.trim()});
  if (error) return showMessage($("workspaceMessage"), error.message, "error");
  await route();
});

async function signOut() { await supabase.auth.signOut(); }
$("workspaceSignOut").addEventListener("click", signOut);
$("signOutBtn").addEventListener("click", signOut);
$("mobileSignOut").addEventListener("click", signOut);

$("projectForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("projectId").value;
  const row = {team_id:team.id,name:$("projectNameInput").value.trim(),description:$("projectDescriptionInput").value.trim(),due_date:$("projectDueInput").value || null};

  let result;
  if (id) result = await supabase.from("projects").update(row).eq("id", id);
  else result = await supabase.from("projects").insert({...row,created_by:session.user.id});

  if (result.error) return toast(result.error.message);
  $("projectDialog").close();
  scheduleReload();
});

$("deleteProjectBtn").addEventListener("click", async () => {
  const id = $("projectId").value;
  if (!id || !confirm("Delete this project and all of its cards?")) return;
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return toast(error.message);
  $("projectDialog").close(); scheduleReload();
});

$("taskForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("taskId").value;
  const row = {
    team_id:team.id,
    project_id:$("taskProjectInput").value,
    title:$("taskTitleInput").value.trim(),
    description:$("taskDescriptionInput").value.trim(),
    status:$("taskStatusInput").value,
    priority:$("taskPriorityInput").value,
    assignee_id:$("taskAssigneeInput").value,
    due_date:$("taskDueInput").value || null
  };

  let taskId = id;
  let result;
  if (id) result = await supabase.from("tasks").update(row).eq("id", id).select("id").single();
  else result = await supabase.from("tasks").insert({...row,created_by:session.user.id}).select("id").single();

  if (result.error) return toast(result.error.message);
  taskId = result.data.id;

  try { await saveChecklist(taskId); }
  catch (err) { return toast(err.message || "Checklist could not be saved."); }

  $("taskDialog").close();
  scheduleReload();
});

$("deleteTaskBtn").addEventListener("click", async () => {
  const id = $("taskId").value;
  if (!id || !confirm("Delete this card?")) return;
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return toast(error.message);
  $("taskDialog").close(); scheduleReload();
});

$("profileForm").addEventListener("submit", async e => {
  e.preventDefault(); clearMessage($("profileMessage"));
  const displayName = $("profileName").value.trim();
  const password = $("newPassword").value;

  const { error: profileError } = await supabase.from("profiles").update({display_name:displayName}).eq("id", session.user.id);
  if (profileError) return showMessage($("profileMessage"), profileError.message, "error");

  const updates = {data:{display_name:displayName}};
  if (password) updates.password = password;
  const { error: authError } = await supabase.auth.updateUser(updates);
  if (authError) return showMessage($("profileMessage"), authError.message, "error");

  profile.display_name = displayName;
  $("newPassword").value = "";
  showMessage($("profileMessage"), "Account updated.", "success");
  await reloadData();
});

$("addChecklistBtn").addEventListener("click", () => {
  checklistDraft.push({text:"",is_done:false});
  renderChecklistEditor();
  const inputs = $("checklistEditor").querySelectorAll('input[type="text"]');
  inputs[inputs.length - 1]?.focus();
});

$("taskStatusInput").addEventListener("change", () => $("taskStatusLabel").textContent = $("taskStatusInput").value.toUpperCase());

$("newProjectBtn").addEventListener("click", () => openProject());
$("newTaskBtn").addEventListener("click", () => projects.length ? openTask() : openProject());

["searchInput","projectFilter","assigneeFilter","priorityFilter"].forEach(id => {
  $(id).addEventListener("input", renderBoard);
  $(id).addEventListener("change", renderBoard);
});

document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => $(btn.dataset.close).close()));
document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));

init();
