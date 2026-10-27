import {login, signup, logout, getUser, handleAuthCallback, requestPasswordRecovery, updateUser, acceptInvite} from "./identity.bundle.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes"];
const TODAY = new Date().toLocaleDateString("sv");
const S = {};
const toast = (m, t = "ok") => { const e = document.createElement("div"); e.className = "toast " + t; e.textContent = m; $("#toasts").append(e); setTimeout(() => e.remove(), 4500); };

/* ---------- Capa de datos: todo pasa por la función /api ---------- */
async function api(action, body = {}) {
  const r = await fetch("/.netlify/functions/api", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action, ...body})});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Error del servidor (¿está desplegada la función y activado Identity?)");
  return j;
}
const db = null, collection = (_, ...p) => ({p}), doc = (_, ...p) => ({p});
function target(p) {
  if (p[0] === "courses") return p.length === 1 ? {col: "courses"} : p.length === 2 ? {col: "courses", id: p[1]} : p.length === 3 ? {col: p[2], cid: p[1]} : {col: p[2], cid: p[1], id: p[3]};
  return {col: "notices", id: p[1]};
}
const addDoc = (ref, data) => api("save", {...target(ref.p), data});
const updateDoc = (ref, data) => ref.p[0] === "users" ? api("profile", {data}) : api("save", {...target(ref.p), data});
const deleteDoc = ref => api("remove", target(ref.p));
const setDoc = (ref, data) => api("setState", {cid: data.courseId, taskId: ref.p[3], done: data.done});
async function list(...p) {
  if (p[0] === "courses") return (await api("list", p.length === 1 ? {col: "courses"} : {col: p[2], cid: p[1]})).items;
  if (p[0] === "notices") return (await api("list", {col: "notices"})).items;
  return (await api("states", {cid: S.cid})).items;
}
const byStart = (a, b) => a.start.localeCompare(b.start);
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const course = id => S.courses.find(c => c.id === id);
const cname = c => c ? c.name + (c.parallel ? " \"" + c.parallel + "\"" : "") : "—";
const empty = m => `<div class="card empty">${esc(m)}</div>`;
const httpOk = u => !u || /^https?:\/\//i.test(u);

/* ---------- Tema ---------- */
function setTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem("theme", t); }
$("#themeBtn").onclick = async () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; setTheme(t);
  try { await updateDoc(doc(db, "users", S.profile.id), {theme: t}); } catch {}
};

/* ---------- Formularios y diálogos ---------- */
function fieldHtml(f, v) {
  const val = v ?? f.d ?? "", req = f.req ? " required" : "", n = `name="${f.n}"`;
  let i;
  if (f.t === "select") i = `<select ${n}${req}>${f.o.map(([k, l]) => `<option value="${esc(k)}" ${k == val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  else if (f.t === "textarea") i = `<textarea ${n} rows="4"${req}>${esc(val)}</textarea>`;
  else if (f.t === "multi") return `<fieldset><legend><b>${f.l}</b></legend>${f.o.map(([k, l]) => `<label class="opt"><input type="checkbox" ${n} value="${esc(k)}" ${(v || []).includes(k) ? "checked" : ""}> ${esc(l)}</label>`).join("")}</fieldset>`;
  else if (f.t === "check") return `<label class="opt"><input type="checkbox" ${n} ${v ?? f.d ? "checked" : ""}> ${f.l}</label>`;
  else i = `<input ${n} type="${f.t || "text"}" value="${esc(val)}"${req}>`;
  return `<label>${f.l}${i}</label>`;
}
function form(title, fields, v, save) {
  const dlg = $("#dlg");
  dlg.innerHTML = `<form class="f"><h2>${esc(title)}</h2>${fields.map(f => fieldHtml(f, (v || {})[f.n])).join("")}<div class="row end"><button type="button" class="btn ghost" id="cx">Cancelar</button><button class="btn" id="ok">Guardar</button></div></form>`;
  dlg.showModal(); $("#cx").onclick = () => dlg.close();
  dlg.querySelector("form").onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target), d = {};
    for (const f of fields) {
      d[f.n] = f.t === "multi" ? fd.getAll(f.n) : f.t === "check" ? fd.get(f.n) === "on" : String(fd.get(f.n) ?? "").trim();
      if (f.req && !d[f.n].length) return toast("Completa: " + f.l.replace(/ \*$/, ""), "err");
    }
    const b = $("#ok"); b.disabled = true; b.textContent = "Guardando…";
    try { await save(d); dlg.close(); } catch (er) { toast(er.message || "Error al guardar", "err"); }
    b.disabled = false; b.textContent = "Guardar";
  };
}
function info(html, buttons = "") { const d = $("#dlg"); d.innerHTML = html + `<div class="row end">${buttons}<button class="btn ghost" id="cx">Cerrar</button></div>`; d.showModal(); $("#cx").onclick = () => d.close(); return d; }
const sure = m => confirm(m);

/* ---------- Datos ---------- */
async function states() {
  if (S.admin) return {};
  return Object.fromEntries((await list("users", S.profile.id, "taskStates")).filter(x => x.courseId === S.cid).map(x => [x.id, x.done]));
}
async function notices() { return (await list("notices")).sort((x, y) => y.created - x.created); }
const live = n => !n.expires || n.expires >= TODAY;
const forCourse = n => n.courseIds.includes("all") || n.courseIds.includes(S.cid);
const subjOpts = subs => [["", "—"], ...subs.map(s => [s.id, s.name])];

/* ---------- Vistas ---------- */
async function vHome() {
  const c = course(S.cid);
  const [sch, subs, tasks, st, nts] = await Promise.all([list("courses", S.cid, "schedule"), list("courses", S.cid, "subjects"), list("courses", S.cid, "tasks"), states(), notices()]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), now = new Date(), hm = now.toTimeString().slice(0, 5);
  const today = sch.filter(b => b.day == now.getDay()).sort(byStart);
  const next = today.find(b => b.type !== "break" && b.end > hm);
  const pend = tasks.filter(t => !st[t.id]);
  const up = pend.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);
  const rec = nts.filter(live).filter(forCourse).slice(0, 3);
  const bn = b => b.type === "break" ? (b.label || "Recreo") : (sm[b.subjectId]?.name || "Materia");
  return `<h1>Hola, ${esc(S.profile.name)} 👋</h1>
  <p class="muted">${esc(cname(c))} · ${now.toLocaleDateString("es", {weekday: "long", day: "numeric", month: "long", year: "numeric"})}</p>
  <div class="grid">
   <div class="card"><div class="muted">Próxima clase</div><h2>${next ? esc(bn(next)) : "Sin más clases hoy"}</h2>${next ? `<p>${next.start} – ${next.end}</p>` : ""}</div>
   <div class="card"><div class="muted">${S.admin ? "Tareas publicadas" : "Tareas pendientes"}</div><div class="stat">${pend.length}</div></div>
   <div class="card"><div class="muted">Accesos rápidos</div><div class="row"><a class="btn sm" href="#horario">Horario</a><a class="btn sm" href="#tareas">Tareas</a><a class="btn sm" href="#biblioteca">Biblioteca</a></div></div>
  </div><h2>Horario de hoy</h2>
  ${today.length ? `<div class="grid">${today.map(b => `<div class="card"><b>${esc(bn(b))}</b><br>${b.start} – ${b.end}</div>`).join("")}</div>` : empty("Todavía no hay clases configuradas para hoy.")}
  <h2>Próximas entregas</h2>${up.length ? `<div class="grid">${up.map(t => `<div class="card"><b>${esc(t.title)}</b><br><span class="muted">${t.due}</span></div>`).join("")}</div>` : empty("No tienes tareas pendientes con fecha.")}
  <h2>Avisos recientes</h2>${rec.length ? `<div class="grid">${rec.map(n => `<div class="card"><span class="badge p-${n.priority}">${n.priority}</span><h3>${esc(n.title)}</h3><p>${esc(n.content)}</p></div>`).join("")}</div>` : empty("No hay avisos recientes.")}`;
}

async function vSchedule() {
  const [subs, sch] = await Promise.all([list("courses", S.cid, "subjects"), list("courses", S.cid, "schedule")]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), dow = new Date().getDay();
  const name = b => b.type === "break" ? (b.label || "Recreo") : (sm[b.subjectId]?.name || "Materia");
  S.after = () => {
    const fields = [
      {n: "day", l: "Día", t: "select", o: DAYS.map((d, i) => [String(i + 1), d])},
      {n: "type", l: "Tipo", t: "select", o: [["class", "Clase"], ["break", "Recreo / descanso"]]},
      {n: "subjectId", l: "Materia (si es clase)", t: "select", o: subjOpts(subs)},
      {n: "label", l: "Nombre del descanso (opcional)"},
      {n: "start", l: "Hora de inicio *", t: "time", req: 1}, {n: "end", l: "Hora de fin *", t: "time", req: 1},
      {n: "teacher", l: "Docente (si es distinto al de la materia)"}, {n: "room", l: "Aula"}, {n: "notes", l: "Observaciones", t: "textarea"}];
    const edit = b => form(b ? "Editar bloque" : "Nuevo bloque", fields, b, async d => {
      if (d.end <= d.start) throw new Error("La hora de fin debe ser posterior al inicio.");
      if (d.type === "class" && !d.subjectId) throw new Error("Elige una materia (crea materias en la sección Materias).");
      if (sch.some(o => o.id !== b?.id && o.day == d.day && !(d.end <= o.start || d.start >= o.end))) throw new Error("Se solapa con otro bloque de ese día.");
      const data = {...d, day: Number(d.day)};
      b ? await updateDoc(doc(db, "courses", S.cid, "schedule", b.id), data) : await addDoc(collection(db, "courses", S.cid, "schedule"), data);
      toast("Horario guardado"); render();
    });
    $("#add") && ($("#add").onclick = () => edit(null));
    $("#main").onclick = e => {
      const el = e.target.closest("[data-id]"); if (!el) return; const b = sch.find(x => x.id === el.dataset.id), s = sm[b.subjectId];
      const d = info(`<h2>${esc(name(b))}</h2><p><b>${DAYS[b.day - 1]}</b> · ${b.start} – ${b.end}</p><p>Docente: ${esc(b.teacher || s?.teacher || "—")}<br>Aula: ${esc(b.room || s?.room || "—")}</p><p>${esc(b.notes || "")}</p>`,
        S.admin ? `<button class="btn ghost" id="ed">Editar</button><button class="btn danger" id="del">Eliminar</button>` : "");
      if (S.admin) { $("#ed").onclick = () => { d.close(); edit(b); }; $("#del").onclick = async () => { if (!sure("¿Eliminar este bloque?")) return; await deleteDoc(doc(db, "courses", S.cid, "schedule", b.id)); d.close(); toast("Bloque eliminado"); render(); }; }
    };
  };
  return `<div class="row between"><h1>Horario</h1>${S.admin ? `<button class="btn" id="add">+ Bloque</button>` : ""}</div>
  ${sch.length || S.admin ? `<div class="grid week">${DAYS.map((d, i) => `<section class="day ${dow == i + 1 ? "today" : ""}"><h3>${d}</h3>${sch.filter(b => b.day == i + 1).sort(byStart).map(b => `<button class="blk ${b.type === "break" ? "brk" : ""}" data-id="${b.id}" style="${b.type === "break" ? "" : "background:" + esc(sm[b.subjectId]?.color || "#4f46e5")}"><b>${esc(name(b))}</b><br>${b.start} – ${b.end}</button>`).join("") || `<p class="muted">Sin clases</p>`}</section>`).join("")}</div>` : empty("Todavía no hay clases configuradas.")}`;
}

async function vSubjects() {
  const subs = await list("courses", S.cid, "subjects");
  S.after = () => {
    const fields = [{n: "name", l: "Nombre *", req: 1}, {n: "color", l: "Color", t: "color", d: "#4f46e5"}, {n: "teacher", l: "Docente"}, {n: "room", l: "Aula"}];
    const edit = s => form(s ? "Editar materia" : "Nueva materia", fields, s, async d => {
      if (subs.some(o => o.id !== s?.id && norm(o.name) === norm(d.name))) throw new Error("Esa materia ya existe en este curso.");
      s ? await updateDoc(doc(db, "courses", S.cid, "subjects", s.id), d) : await addDoc(collection(db, "courses", S.cid, "subjects"), d);
      toast("Materia guardada"); render();
    });
    $("#add").onclick = () => edit(null);
    $("#main").onclick = async e => {
      const b = e.target.closest("[data-ed],[data-del]"); if (!b) return;
      if (b.dataset.ed) return edit(subs.find(x => x.id === b.dataset.ed));
      const used = (await list("courses", S.cid, "schedule")).some(x => x.subjectId === b.dataset.del) || (await list("courses", S.cid, "tasks")).some(x => x.subjectId === b.dataset.del);
      if (used) return toast("No se puede eliminar: la materia se usa en el horario o en tareas.", "err");
      if (!sure("¿Eliminar la materia?")) return;
      await deleteDoc(doc(db, "courses", S.cid, "subjects", b.dataset.del)); toast("Materia eliminada"); render();
    };
  };
  return `<div class="row between"><h1>Materias</h1><button class="btn" id="add">+ Materia</button></div>${subs.length ? `<div class="grid">${subs.map(s => `<div class="card"><h3><span class="sw" style="background:${esc(s.color)}"></span> ${esc(s.name)}</h3><p class="muted">${esc(s.teacher || "Sin docente")} · ${esc(s.room || "Sin aula")}</p><div class="row"><button class="btn sm ghost" data-ed="${s.id}">Editar</button><button class="btn sm danger" data-del="${s.id}">Eliminar</button></div></div>`).join("")}</div>` : empty("Aún no hay materias. Crea la primera.")}`;
}

async function vTasks() {
  const [subs, tasks, st] = await Promise.all([list("courses", S.cid, "subjects"), list("courses", S.cid, "tasks"), states()]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s]));
  let counts = {}, total = 0;
  if (S.admin) { const r = await api("stateCounts", {cid: S.cid}); counts = r.counts; total = r.total; }
  const flt = {q: "", sub: "", est: ""};
  const draw = () => {
    const v = tasks.filter(t => (!flt.q || norm(t.title + t.description).includes(norm(flt.q))) && (!flt.sub || t.subjectId === flt.sub)
      && (!flt.est || (flt.est === "done" ? st[t.id] : flt.est === "pending" ? !st[t.id] : !st[t.id] && t.due && t.due < TODAY))).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    const done = tasks.filter(t => st[t.id]).length;
    $("#tl").innerHTML = (S.admin ? "" : `<div class="card"><b>Progreso: ${done}/${tasks.length}</b><div class="bar"><i style="width:${tasks.length ? done / tasks.length * 100 : 0}%"></i></div></div>`) +
      (v.length ? `<div class="grid">${v.map(t => { const d = !!st[t.id], late = !d && t.due && t.due < TODAY; return `<article class="card task ${d ? "done" : ""}"><div class="row"><span class="badge p-${t.priority}">${t.priority}</span>${late ? '<span class="badge late">Vencida</span>' : ""}</div><h3>${esc(t.title)}</h3><p class="muted">${esc(sm[t.subjectId]?.name || "Sin materia")} · Entrega: ${t.due || "sin fecha"}</p><p>${esc(t.description)}</p>${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">Abrir enlace</a>` : ""}<div class="row">${S.admin ? `<span class="badge">${counts[t.id] || 0}/${total} completaron</span><button class="btn sm ghost" data-ed="${t.id}">Editar</button><button class="btn sm danger" data-del="${t.id}">Eliminar</button>` : `<label class="chk"><input type="checkbox" data-done="${t.id}" ${d ? "checked" : ""}> Completada</label>`}</div></article>`; }).join("")}</div>` : empty(tasks.length ? "Ninguna tarea coincide con los filtros." : "No hay tareas publicadas."));
  };
  S.after = () => {
    draw();
    $("#q").oninput = e => { flt.q = e.target.value; draw(); }; $("#fs").onchange = e => { flt.sub = e.target.value; draw(); }; $("#fe").onchange = e => { flt.est = e.target.value; draw(); };
    const fields = [{n: "title", l: "Título *", req: 1}, {n: "subjectId", l: "Materia", t: "select", o: subjOpts(subs)}, {n: "description", l: "Descripción e instrucciones", t: "textarea"},
      {n: "published", l: "Fecha de publicación", t: "date", d: TODAY}, {n: "due", l: "Fecha límite", t: "date"}, {n: "priority", l: "Prioridad", t: "select", o: [["baja", "Baja"], ["media", "Media"], ["alta", "Alta"]], d: "media"}, {n: "link", l: "Enlace adjunto (opcional)", t: "url"}];
    const edit = t => form(t ? "Editar tarea" : "Nueva tarea", fields, t, async d => {
      if (!httpOk(d.link)) throw new Error("El enlace debe empezar con http:// o https://");
      t ? await updateDoc(doc(db, "courses", S.cid, "tasks", t.id), d) : await addDoc(collection(db, "courses", S.cid, "tasks"), {...d, created: Date.now()});
      toast("Tarea guardada"); render();
    });
    $("#add") && ($("#add").onclick = () => edit(null));
    $("#main").onclick = async e => {
      const t = e.target.closest("[data-ed],[data-del],[data-done]"); if (!t) return;
      if (t.dataset.ed) return edit(tasks.find(x => x.id === t.dataset.ed));
      if (t.dataset.del) { if (!sure("¿Eliminar la tarea?")) return; await deleteDoc(doc(db, "courses", S.cid, "tasks", t.dataset.del)); toast("Tarea eliminada"); return render(); }
      try { await setDoc(doc(db, "users", S.profile.id, "taskStates", t.dataset.done), {done: t.checked, courseId: S.cid, at: Date.now()}); st[t.dataset.done] = t.checked; draw(); }
      catch { toast("No se pudo guardar el estado", "err"); t.checked = !t.checked; }
    };
  };
  return `<div class="row between"><h1>Tareas</h1>${S.admin ? `<button class="btn" id="add">+ Tarea</button>` : ""}</div>
  <div class="row"><input id="q" placeholder="Buscar…" aria-label="Buscar" style="max-width:240px"><select id="fs" style="max-width:200px" aria-label="Materia">${subjOpts(subs).map(([k, l]) => `<option value="${esc(k)}">${k ? esc(l) : "Todas las materias"}</option>`).join("")}</select>
  <select id="fe" style="max-width:200px" aria-label="Estado"><option value="">Todos los estados</option><option value="pending">Pendientes</option><option value="done">Completadas</option><option value="late">Vencidas</option></select></div><div id="tl"></div>`;
}

async function vNotices() {
  const nts = (await notices()).filter(n => S.admin || (live(n) && forCourse(n)));
  const label = n => n.courseIds.includes("all") ? "Todos los cursos" : n.courseIds.map(i => cname(course(i))).join(", ");
  S.after = () => {
    const fields = [{n: "title", l: "Título *", req: 1}, {n: "content", l: "Contenido *", t: "textarea", req: 1}, {n: "priority", l: "Prioridad", t: "select", o: [["baja", "Baja"], ["media", "Media"], ["alta", "Alta"]], d: "media"},
      {n: "expires", l: "Vence (opcional)", t: "date"}, {n: "courseIds", l: "Dirigido a *", t: "multi", req: 1, o: [["all", "Todos los cursos"], ...S.courses.filter(c => c.active !== false).map(c => [c.id, cname(c)])]}];
    const edit = n => form(n ? "Editar aviso" : "Nuevo aviso", fields, n, async d => {
      if (d.courseIds.includes("all")) d.courseIds = ["all"];
      n ? await updateDoc(doc(db, "notices", n.id), d) : await addDoc(collection(db, "notices"), {...d, created: Date.now()});
      toast("Aviso publicado"); render();
    });
    $("#add") && ($("#add").onclick = () => edit(null));
    $("#main").onclick = async e => {
      const b = e.target.closest("[data-ed],[data-del]"); if (!b) return;
      if (b.dataset.ed) return edit(nts.find(x => x.id === b.dataset.ed));
      if (!sure("¿Eliminar el aviso?")) return; await deleteDoc(doc(db, "notices", b.dataset.del)); toast("Aviso eliminado"); render();
    };
  };
  return `<div class="row between"><h1>Avisos</h1>${S.admin ? `<button class="btn" id="add">+ Aviso</button>` : ""}</div>${nts.length ? `<div class="grid">${nts.map(n => `<article class="card"><span class="badge p-${n.priority}">${n.priority}</span> <small class="muted">${new Date(n.created).toLocaleDateString("es")}${n.expires ? " · vence " + n.expires : ""}</small><h3>${esc(n.title)}</h3><p>${esc(n.content)}</p>${S.admin ? `<p class="muted">Para: ${esc(label(n))}</p><div class="row"><button class="btn sm ghost" data-ed="${n.id}">Editar</button><button class="btn sm danger" data-del="${n.id}">Eliminar</button></div>` : ""}</article>`).join("")}</div>` : empty("No hay avisos por ahora.")}`;
}

async function vLibrary() {
  const [subs, res] = await Promise.all([list("courses", S.cid, "subjects"), list("courses", S.cid, "resources")]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), flt = {q: "", sub: ""};
  const draw = () => {
    const v = res.filter(r => (!flt.q || norm(r.title + r.description).includes(norm(flt.q))) && (!flt.sub || r.subjectId === flt.sub)).sort((a, b) => b.created - a.created);
    $("#rl").innerHTML = v.length ? `<div class="grid">${v.map(r => `<article class="card"><span class="badge">${esc(r.type)}</span><h3>${esc(r.title)}</h3><p class="muted">${esc(sm[r.subjectId]?.name || "General")} · ${new Date(r.created).toLocaleDateString("es")}</p><p>${esc(r.description)}</p><div class="row"><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Abrir</a>${S.admin ? `<button class="btn sm ghost" data-ed="${r.id}">Editar</button><button class="btn sm danger" data-del="${r.id}">Eliminar</button>` : ""}</div></article>`).join("")}</div>` : empty(res.length ? "Nada coincide con la búsqueda." : "La biblioteca está vacía.");
  };
  S.after = () => {
    draw(); $("#q").oninput = e => { flt.q = e.target.value; draw(); }; $("#fs").onchange = e => { flt.sub = e.target.value; draw(); };
    const fields = [{n: "title", l: "Título *", req: 1}, {n: "type", l: "Tipo", t: "select", o: ["PDF", "Apuntes", "Guía de estudio", "Enlace"].map(x => [x, x])}, {n: "subjectId", l: "Materia", t: "select", o: subjOpts(subs)}, {n: "url", l: "Enlace al recurso *", t: "url", req: 1}, {n: "description", l: "Descripción", t: "textarea"}];
    const edit = r => form(r ? "Editar recurso" : "Nuevo recurso", fields, r, async d => {
      if (!httpOk(d.url)) throw new Error("El enlace debe empezar con http:// o https://");
      r ? await updateDoc(doc(db, "courses", S.cid, "resources", r.id), d) : await addDoc(collection(db, "courses", S.cid, "resources"), {...d, created: Date.now()});
      toast("Recurso guardado"); render();
    });
    $("#add") && ($("#add").onclick = () => edit(null));
    $("#main").onclick = async e => {
      const b = e.target.closest("[data-ed],[data-del]"); if (!b) return;
      if (b.dataset.ed) return edit(res.find(x => x.id === b.dataset.ed));
      if (!sure("¿Eliminar el recurso?")) return; await deleteDoc(doc(db, "courses", S.cid, "resources", b.dataset.del)); toast("Recurso eliminado"); render();
    };
  };
  return `<div class="row between"><h1>Biblioteca</h1>${S.admin ? `<button class="btn" id="add">+ Recurso</button>` : ""}</div><div class="row"><input id="q" placeholder="Buscar…" aria-label="Buscar" style="max-width:240px"><select id="fs" style="max-width:200px" aria-label="Materia">${subjOpts(subs).map(([k, l]) => `<option value="${esc(k)}">${k ? esc(l) : "Todas las materias"}</option>`).join("")}</select></div><div id="rl"></div>`;
}

async function vCourses() {
  const cnt = (await api("courseCounts")).counts;
  const flt = {q: "", st: ""};
  const draw = () => {
    const v = S.courses.filter(c => (!flt.q || norm(Object.values(c).join(" ")).includes(norm(flt.q))) && (!flt.st || (flt.st === "on") === (c.active !== false)));
    $("#cl").innerHTML = v.length ? `<div class="grid">${v.map(c => `<article class="card"><span class="badge">${c.active !== false ? "Activo" : "Archivado"}</span><h3>${esc(cname(c))}</h3><p class="muted">${esc([c.level, c.specialty, c.shift].filter(Boolean).join(" · "))}</p><p>${esc(c.description)}</p><p><b>${cnt[c.id] || 0}</b> estudiantes</p><div class="row"><button class="btn sm" data-sel="${c.id}">Administrar</button><button class="btn sm ghost" data-ed="${c.id}">Editar</button><button class="btn sm ghost" data-arc="${c.id}">${c.active !== false ? "Archivar" : "Activar"}</button></div></article>`).join("")}</div>` : empty(S.courses.length ? "Ningún curso coincide." : "Aún no hay cursos. Crea el primero con «+ Curso».");
  };
  S.after = () => {
    draw(); $("#q").oninput = e => { flt.q = e.target.value; draw(); }; $("#fs").onchange = e => { flt.st = e.target.value; draw(); };
    const fields = [{n: "name", l: "Nombre del curso *", req: 1}, {n: "level", l: "Nivel o año"}, {n: "parallel", l: "Paralelo"}, {n: "specialty", l: "Especialidad"}, {n: "shift", l: "Jornada"}, {n: "description", l: "Descripción", t: "textarea"}, {n: "active", l: "Curso activo", t: "check", d: true}];
    const edit = c => form(c ? "Editar curso" : "Nuevo curso", fields, c && {...c, active: c.active !== false}, async d => {
      const key = x => norm([x.name, x.level, x.parallel, x.specialty, x.shift].join("|"));
      if (S.courses.some(o => o.id !== c?.id && key(o) === key(d))) throw new Error("Ya existe un curso igual (nombre, nivel, paralelo, especialidad y jornada).");
      if (c) await updateDoc(doc(db, "courses", c.id), d); else await addDoc(collection(db, "courses"), {...d, created: Date.now()});
      toast("Curso guardado"); await loadCourses(); render();
    });
    $("#add").onclick = () => edit(null);
    $("#main").onclick = async e => {
      const b = e.target.closest("[data-sel],[data-ed],[data-arc]"); if (!b) return;
      if (b.dataset.sel) { S.cid = b.dataset.sel; sessionStorage.cid = S.cid; fillSel(); location.hash = "horario"; return; }
      if (b.dataset.ed) return edit(course(b.dataset.ed));
      const c = course(b.dataset.arc), on = c.active !== false;
      if (!sure(on ? `¿Archivar «${cname(c)}»? Sus datos se conservan.` : "¿Reactivar el curso?")) return;
      await updateDoc(doc(db, "courses", c.id), {active: !on}); await loadCourses(); render();
    };
  };
  return `<div class="row between"><h1>Gestión de cursos</h1><button class="btn" id="add">+ Curso</button></div><div class="row"><input id="q" placeholder="Buscar curso…" aria-label="Buscar" style="max-width:240px"><select id="fs" style="max-width:200px" aria-label="Estado"><option value="">Todos</option><option value="on">Activos</option><option value="off">Archivados</option></select></div><div id="cl"></div>`;
}

async function vStudents() {
  const st = (await api("students")).items.sort((x, y) => (!!x.courseId - !!y.courseId) || x.name.localeCompare(y.name));
  const opts = [["", "— Sin curso —"], ...S.courses.map(c => [c.id, cname(c) + (c.active === false ? " (archivado)" : "")])];
  const status = x => !x.courseId ? "Pendiente de curso" : x.active ? "Activo" : "Desactivado";
  S.after = () => {
    $("#main").onclick = e => {
      const b = e.target.closest("[data-ed]"); if (!b) return; const s = st.find(x => x.id === b.dataset.ed);
      form("Editar estudiante", [{n: "name", l: "Nombre", req: 1}, {n: "courseId", l: "Curso", t: "select", o: opts}, {n: "active", l: "Acceso activo", t: "check"}], s, async d => { await api("updateStudent", {uid: s.id, ...d}); toast("Estudiante actualizado"); render(); });
    };
  };
  return `<h1>Estudiantes</h1><p class="muted">Los estudiantes crean su cuenta desde la pantalla de inicio y quedan pendientes. Aquí les asignas un curso y activas su acceso.</p>${st.length ? `<div class="card tw"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Curso</th><th>Estado</th><th></th></tr></thead><tbody>${st.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(x.courseId ? cname(course(x.courseId)) : "—")}</td><td>${status(x)}</td><td><button class="btn sm ghost" data-ed="${x.id}">Editar</button></td></tr>`).join("")}</tbody></table></div>` : empty("Aún no hay estudiantes registrados.")}`;
}

async function vProfile() {
  const p = S.profile;
  S.after = () => {
    $("#pf").onsubmit = async e => { e.preventDefault(); const n = new FormData(e.target).get("name").trim(); if (!n) return toast("El nombre es obligatorio", "err"); await updateDoc(doc(db, "users", p.id), {name: n}); p.name = n; toast("Perfil actualizado"); };
    $("#rp").onclick = async () => { await requestPasswordRecovery(p.email); toast("Te enviamos un correo para cambiar la contraseña"); };
  };
  return `<h1>Perfil</h1><form id="pf" class="card" style="max-width:480px"><label>Nombre visible<input name="name" value="${esc(p.name)}" required></label><p>Correo: <b>${esc(p.email)}</b><br>Rol: <b>${S.admin ? "Administrador" : "Estudiante"}</b>${S.admin ? "" : `<br>Curso: <b>${esc(cname(course(p.courseId)))}</b>`}</p><div class="row"><button class="btn">Guardar</button><button type="button" class="btn ghost" id="rp">Cambiar contraseña</button></div></form>`;
}

/* ---------- Navegación ---------- */
const ROUTES = {inicio: ["🏠 Inicio", vHome, 1], horario: ["🗓️ Horario", vSchedule, 1], tareas: ["✅ Tareas", vTasks, 1], avisos: ["📢 Avisos", vNotices, 0], biblioteca: ["📚 Biblioteca", vLibrary, 1],
  cursos: ["🏫 Cursos", vCourses, 0, 1], materias: ["🎨 Materias", vSubjects, 1, 1], estudiantes: ["👥 Estudiantes", vStudents, 0, 1], perfil: ["👤 Perfil", vProfile, 0]};
async function render() {
  if (S.pending) { $("#nav").innerHTML = ""; $("#main").innerHTML = empty("Tu cuenta está pendiente: el administrador debe asignarte un curso y activar tu acceso. Vuelve a entrar más tarde."); return; }
  const key = location.hash.slice(1) || "inicio", r = ROUTES[key] && (!ROUTES[key][3] || S.admin) ? ROUTES[key] : ROUTES.inicio;
  $("#nav").innerHTML = Object.entries(ROUTES).filter(([, v]) => !v[3] || S.admin).map(([k, v]) => `<a href="#${k}" class="${ROUTES[key] === v ? "on" : ""}">${v[0]}</a>`).join("");
  $("#side").classList.remove("open"); const m = $("#main"); S.after = null; m.onclick = null;
  if (r[2] && !S.cid) { m.innerHTML = empty(S.admin ? "Primero crea un curso en «Cursos»." : "Tu cuenta aún no tiene un curso asignado."); return; }
  m.innerHTML = `<div class="spin" role="status" aria-label="Cargando"></div>`;
  try { m.innerHTML = await r[1](); S.after && S.after(); } catch (e) { console.error(e); m.innerHTML = empty("No se pudo cargar esta sección. Revisa tu conexión y los permisos."); }
}
window.addEventListener("hashchange", render);
$("#menu").onclick = () => $("#side").classList.toggle("open");
$("#logout").onclick = async () => { await logout(); location.reload(); };
function fillSel() {
  const sel = $("#courseSel"); sel.hidden = !S.admin || !S.courses.length; if (sel.hidden) return;
  sel.innerHTML = S.courses.map(c => `<option value="${c.id}" ${c.id === S.cid ? "selected" : ""}>${esc(cname(c))}${c.active === false ? " (archivado)" : ""}</option>`).join("");
  sel.onchange = () => { S.cid = sel.value; sessionStorage.cid = S.cid; render(); };
}
async function loadCourses() {
  S.courses = (await list("courses")).sort((x, y) => x.name.localeCompare(y.name));
  if (S.admin) { if (!course(S.cid)) S.cid = course(sessionStorage.cid) ? sessionStorage.cid : (S.courses.find(c => c.active !== false) || S.courses[0])?.id; fillSel(); }
  else S.cid = S.courses[0]?.id;
}

/* ---------- Sesión (Netlify Identity) ---------- */
const pwField = [{n: "password", l: "Contraseña (mínimo 8 caracteres) *", t: "password", req: 1}];
const pwCheck = d => { if (d.password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres."); };
async function start() {
  S.pending = false; const u = await getUser();
  $("#login").hidden = !!u; $("#shell").hidden = !u; if (!u) return;
  try {
    const m = await api("me"); S.admin = m.admin; S.profile = m.profile; setTheme(S.profile.theme || localStorage.theme || "light");
    if (!S.admin && (!S.profile.active || !S.profile.courseId)) S.pending = true; else await loadCourses();
    render();
  } catch (e) { console.error(e); toast(e.message || "No se pudo iniciar la sesión.", "err"); }
}
$("#loginForm").onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), b = $("#loginBtn"); b.disabled = true; b.textContent = "Entrando…";
  try { await login(f.get("email"), f.get("password")); await start(); }
  catch (er) { toast(er.status === 401 ? "Correo o contraseña incorrectos." : er.status === 403 ? "Confirma tu correo antes de entrar." : (er.message || "No se pudo entrar."), "err"); }
  b.disabled = false; b.textContent = "Entrar";
};
$("#forgot").onclick = async () => {
  const email = $("#loginForm").email.value.trim(); if (!email) return toast("Escribe tu correo arriba primero.", "err");
  try { await requestPasswordRecovery(email); } catch {} toast("Si el correo existe, recibirás un enlace para recuperar tu contraseña.");
};
$("#signup").onclick = () => form("Crear cuenta de estudiante", [{n: "name", l: "Nombre completo *", req: 1}, {n: "email", l: "Correo *", t: "email", req: 1}, ...pwField], null, async d => {
  pwCheck(d); const u = await signup(d.email, d.password, {full_name: d.name});
  if (u.emailVerified) await start(); else toast("Te enviamos un correo: confírmalo y luego entra. El administrador te asignará un curso.");
});
let cb = null;
try { cb = await handleAuthCallback(); } catch (er) { toast(er.message || "Enlace no válido o vencido.", "err"); }
await start();
if (cb?.type === "confirmation") toast("Correo confirmado.");
if (cb?.type === "recovery") form("Nueva contraseña", pwField, null, async d => { pwCheck(d); await updateUser({password: d.password}); toast("Contraseña actualizada"); });
if (cb?.type === "invite") form("Define tu contraseña", pwField, null, async d => { pwCheck(d); await acceptInvite(cb.token, d.password); toast("Cuenta lista"); await start(); });
