// API única de AulaClick. Toda lectura/escritura pasa por aquí: el navegador nunca toca los datos directamente.
import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";

const J = (status, body) => Response.json(body, { status });
const clip = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const link = v => { v = clip(v, 500); return /^https?:\/\//i.test(v) ? v : ""; };
const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(clip(v, 10)) ? clip(v, 10) : "");
const hhmm = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PRI = p => (["baja", "media", "alta"].includes(p) ? p : "media");
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const SUB = ["subjects", "schedule", "tasks", "resources"];
const key = (col, cid, id) => (SUB.includes(col) ? `${col}/${cid}/${id}` : `${col}/${id}`);

const CLEAN = {
  courses: d => ({ name: clip(d.name, 80), level: clip(d.level, 60), parallel: clip(d.parallel, 20), specialty: clip(d.specialty, 80), shift: clip(d.shift, 40), description: clip(d.description, 500), active: d.active !== false }),
  subjects: d => ({ name: clip(d.name, 80), color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#4f46e5", teacher: clip(d.teacher, 80), room: clip(d.room, 40) }),
  schedule: d => ({ day: Math.min(5, Math.max(1, Number(d.day) || 1)), type: d.type === "break" ? "break" : "class", subjectId: clip(d.subjectId, 64), label: clip(d.label, 60), start: clip(d.start, 5), end: clip(d.end, 5), teacher: clip(d.teacher, 80), room: clip(d.room, 40), notes: clip(d.notes, 500) }),
  tasks: d => ({ title: clip(d.title, 120), subjectId: clip(d.subjectId, 64), description: clip(d.description, 2000), published: day(d.published), due: day(d.due), priority: PRI(d.priority), link: link(d.link) }),
  resources: d => ({ title: clip(d.title, 120), type: clip(d.type, 30), subjectId: clip(d.subjectId, 64), url: link(d.url), description: clip(d.description, 1000) }),
  notices: d => ({ title: clip(d.title, 120), content: clip(d.content, 3000), priority: PRI(d.priority), expires: day(d.expires), courseIds: (Array.isArray(d.courseIds) ? d.courseIds : []).map(x => clip(x, 64)).filter(x => x === "all" || ID.test(x)).slice(0, 100) }),
};

function validate(col, d) {
  if ((col === "courses" || col === "subjects") && !d.name) return "El nombre es obligatorio.";
  if (["tasks", "resources", "notices"].includes(col) && !d.title) return "El título es obligatorio.";
  if (col === "resources" && !d.url) return "Falta un enlace válido (debe empezar con http:// o https://).";
  if (col === "notices" && (!d.content || !d.courseIds.length)) return "Falta el contenido o el destinatario.";
  if (col === "schedule") {
    if (!hhmm(d.start) || !hhmm(d.end)) return "Horas no válidas.";
    if (d.end <= d.start) return "La hora de fin debe ser posterior al inicio.";
    if (d.type === "class" && !d.subjectId) return "Elige una materia.";
  }
}

async function all(s, prefix) {
  const { blobs } = await s.list({ prefix });
  const out = await Promise.all(blobs.map(async b => { const v = await s.get(b.key, { type: "json" }); return v ? { id: b.key.split("/").pop(), ...v } : null; }));
  return out.filter(Boolean);
}

export default async (req) => {
  if (req.method !== "POST") return J(405, { error: "Método no permitido." });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return J(403, { error: "Origen no permitido." });
  const user = await getUser();
  if (!user) return J(401, { error: "Inicia sesión." });
  let b; try { b = await req.json(); } catch { return J(400, { error: "Solicitud inválida." }); }

  const s = getStore({ name: "aulaclick", consistency: "strong" });
  const admin = (user.roles || []).includes("admin");
  const role = admin ? "admin" : "student";
  let prof = await s.get("users/" + user.id, { type: "json" });
  if (!prof) {
    prof = { name: clip(user.name || user.email, 80), email: clip(user.email, 120), role, courseId: "", active: admin, theme: "light", created: Date.now() };
    await s.setJSON("users/" + user.id, prof);
  } else if (prof.role !== role) {
    prof.role = role; if (admin) prof.active = true;
    await s.setJSON("users/" + user.id, prof);
  }
  const member = cid => !admin && prof.active === true && prof.courseId === cid;
  const needAdmin = () => J(403, { error: "Solo el administrador puede hacer esto." });
  const courseExists = cid => ID.test(cid || "") && s.get("courses/" + cid, { type: "json" });

  try {
    switch (b.action) {
      case "me":
        return J(200, { admin, profile: { id: user.id, ...prof } });

      case "profile": {
        const name = clip(b.data?.name, 80), theme = b.data?.theme;
        if (b.data && "name" in b.data) { if (!name) return J(400, { error: "El nombre es obligatorio." }); prof.name = name; }
        if (theme === "light" || theme === "dark") prof.theme = theme;
        await s.setJSON("users/" + user.id, prof);
        return J(200, { ok: true });
      }

      case "list": {
        const col = b.col;
        if (col === "courses") {
          const items = await all(s, "courses/");
          return J(200, { items: admin ? items : items.filter(c => member(c.id)) });
        }
        if (col === "notices") {
          const items = await all(s, "notices/");
          return J(200, { items: admin ? items : items.filter(n => prof.active && prof.courseId && (n.courseIds.includes("all") || n.courseIds.includes(prof.courseId))) });
        }
        if (SUB.includes(col)) {
          if (!ID.test(b.cid || "") || !(admin || member(b.cid))) return J(403, { error: "Sin acceso a ese curso." });
          return J(200, { items: await all(s, `${col}/${b.cid}/`) });
        }
        return J(400, { error: "Colección desconocida." });
      }

      case "save": {
        if (!admin) return needAdmin();
        const { col, cid, id: given } = b;
        if (!CLEAN[col]) return J(400, { error: "Colección desconocida." });
        if (SUB.includes(col) && !(await courseExists(cid))) return J(400, { error: "El curso no existe." });
        if (given && !ID.test(given)) return J(400, { error: "Identificador no válido." });
        const id = given || crypto.randomUUID();
        const k = key(col, cid, id);
        const old = given ? await s.get(k, { type: "json" }) : null;
        if (given && !old) return J(404, { error: "El registro no existe." });
        const d = CLEAN[col]({ ...old, ...b.data });
        const err = validate(col, d); if (err) return J(400, { error: err });
        if (col === "courses") {
          const sig = x => norm([x.name, x.level, x.parallel, x.specialty, x.shift].join("|"));
          if ((await all(s, "courses/")).some(o => o.id !== id && sig(o) === sig(d))) return J(409, { error: "Ya existe un curso igual (nombre, nivel, paralelo, especialidad y jornada)." });
        }
        if (col === "subjects" && (await all(s, `subjects/${cid}/`)).some(o => o.id !== id && norm(o.name) === norm(d.name))) return J(409, { error: "Esa materia ya existe en este curso." });
        if (col === "schedule" && (await all(s, `schedule/${cid}/`)).some(o => o.id !== id && o.day === d.day && !(d.end <= o.start || d.start >= o.end))) return J(409, { error: "Se solapa con otro bloque de ese día." });
        await s.setJSON(k, { ...d, created: old?.created || Date.now() });
        return J(200, { id });
      }

      case "remove": {
        if (!admin) return needAdmin();
        const { col, cid, id } = b;
        if (col === "courses") return J(400, { error: "Los cursos se archivan, no se eliminan." });
        if (!CLEAN[col] || !ID.test(id || "") || (SUB.includes(col) && !ID.test(cid || ""))) return J(400, { error: "Solicitud no válida." });
        if (col === "subjects") {
          const used = [...await all(s, `schedule/${cid}/`), ...await all(s, `tasks/${cid}/`), ...await all(s, `resources/${cid}/`)].some(x => x.subjectId === id);
          if (used) return J(409, { error: "No se puede eliminar: la materia se usa en el horario, tareas o recursos." });
        }
        if (col === "tasks") for (const x of (await s.list({ prefix: `states/${cid}/${id}/` })).blobs) await s.delete(x.key);
        await s.delete(key(col, cid, id));
        return J(200, { ok: true });
      }

      case "states": {
        if (!ID.test(b.cid || "") || !member(b.cid)) return J(200, { items: [] });
        const { blobs } = await s.list({ prefix: `states/${b.cid}/` });
        const items = blobs.map(x => x.key.split("/")).filter(p => p[3] === user.id).map(p => ({ id: p[2], done: true, courseId: b.cid }));
        return J(200, { items });
      }

      case "setState": {
        if (!ID.test(b.cid || "") || !ID.test(b.taskId || "") || !member(b.cid)) return J(403, { error: "Sin acceso." });
        if (!(await s.get(`tasks/${b.cid}/${b.taskId}`, { type: "json" }))) return J(404, { error: "La tarea no existe." });
        const k = `states/${b.cid}/${b.taskId}/${user.id}`;
        if (b.done === true) await s.setJSON(k, { at: Date.now() }); else await s.delete(k);
        return J(200, { ok: true });
      }

      case "stateCounts": {
        if (!admin) return needAdmin();
        if (!ID.test(b.cid || "")) return J(400, { error: "Curso no válido." });
        const counts = {};
        for (const x of (await s.list({ prefix: `states/${b.cid}/` })).blobs) { const t = x.key.split("/")[2]; counts[t] = (counts[t] || 0) + 1; }
        const total = (await all(s, "users/")).filter(u => u.role === "student" && u.active && u.courseId === b.cid).length;
        return J(200, { counts, total });
      }

      case "courseCounts": {
        if (!admin) return needAdmin();
        const counts = {};
        (await all(s, "users/")).filter(u => u.role === "student" && u.courseId).forEach(u => { counts[u.courseId] = (counts[u.courseId] || 0) + 1; });
        return J(200, { counts });
      }

      case "students": {
        if (!admin) return needAdmin();
        const items = (await all(s, "users/")).filter(u => u.role === "student").map(u => ({ id: u.id, name: u.name, email: u.email, courseId: u.courseId, active: u.active, created: u.created }));
        return J(200, { items });
      }

      case "updateStudent": {
        if (!admin) return needAdmin();
        if (!ID.test(b.uid || "")) return J(400, { error: "Estudiante no válido." });
        const p = await s.get("users/" + b.uid, { type: "json" });
        if (!p || p.role !== "student") return J(404, { error: "Estudiante no encontrado." });
        const cid = clip(b.courseId, 64);
        if (cid && !(await courseExists(cid))) return J(400, { error: "El curso no existe." });
        const active = b.active === true;
        if (active && !cid) return J(400, { error: "Asigna un curso antes de activar el acceso." });
        await s.setJSON("users/" + b.uid, { ...p, name: clip(b.name, 80) || p.name, courseId: cid, active });
        return J(200, { ok: true });
      }

      default:
        return J(400, { error: "Acción desconocida." });
    }
  } catch (e) {
    console.error(e);
    return J(500, { error: "No se pudo completar la operación." });
  }
};
