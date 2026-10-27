# AulaClick (versión solo Netlify)

Mismas funciones que la versión Firebase: cursos, materias, horarios, tareas, avisos, biblioteca y estudiantes. Todo vive en Netlify:

- **Netlify Identity**: cuentas e inicio de sesión (el rol `admin` lo asignas tú en el panel de Netlify).
- **Netlify Blobs**: base de datos (los datos persisten al volver a desplegar).
- **Netlify Function** `netlify/functions/api.mjs`: único punto de acceso a los datos. Revisa quién eres, tu rol y tu curso en CADA petición. El navegador nunca toca la base de datos.

```
public/                 sitio (index.html, css, js/app.js)
src/identity.js         pequeño paquete que Netlify compila para el navegador
netlify/functions/api.mjs   toda la seguridad y los datos
netlify.toml · package.json
```

## Publicar (paso a paso)
1. Sube esta carpeta a un repositorio de GitHub.
2. Netlify → **Add new site → Import an existing project → GitHub** → elige el repositorio. La configuración (`npm run build`, carpeta `public`) ya viene en `netlify.toml`. Pulsa **Deploy**.
3. Cuando termine: **Project configuration → Identity → Enable Identity**.
   - Registro (Registration): **Open** (abierto). Los estudiantes se crean la cuenta solos, pero quedan *pendientes* y no ven nada hasta que tú les asignes un curso.
   - Confirmación por correo (Autoconfirm): déjala **apagada** para que confirmen su correo.
4. **Crear el administrador (seguro, sin terminal):** en Netlify, **Identity → Invite users** → escribe tu correo. Abre el correo, pulsa el enlace (te lleva a tu sitio), define tu contraseña. Luego, en **Identity**, abre tu usuario → **Roles** → agrega `admin` → guarda. Cierra sesión y vuelve a entrar.
5. Actualizar la página: haz cambios, `git push`, y Netlify redespliega solo. Los datos no se borran.

> Identity no funciona con `netlify dev` en tu PC: prueba siempre en el sitio publicado.

## Uso
1. **Cursos → + Curso** (crea los que necesites; se archivan, no se borran).
2. Elige el curso arriba → **Materias**, **Horario**, **Tareas**, **Avisos**, **Biblioteca**.
3. Los estudiantes pulsan **Crear cuenta de estudiante**, confirman su correo y entran. Tú, en **Estudiantes**, les asignas curso y activas el acceso.

## Pruebas recomendadas
- Crea 2 cursos y 2 estudiantes (uno en cada curso, en ventana privada). Cada uno solo debe ver su curso y no debe tener botones de edición.
- Marca una tarea como completada con un estudiante: el otro no debe verla marcada.
- Desactiva un estudiante y comprueba que ya no puede ver datos.

## Limitaciones (importante)
- **No lo he podido ejecutar contra un Netlify real.** Revisé la sintaxis y la documentación actual de Identity, pero haz las pruebas anteriores antes de usarlo con estudiantes. Las dependencias (`@netlify/identity`, `@netlify/blobs`) están en `latest`: si un despliegue falla por una versión nueva, revisa el registro de build y dime el mensaje.
- La biblioteca guarda **enlaces**, no sube archivos.
- Cualquiera puede registrarse, pero sin curso asignado no accede a nada. Si prefieres registro cerrado, ponlo en **Invite only** y tendrás que invitar a cada estudiante desde el panel de Identity (se asigna el curso igual desde aquí).
