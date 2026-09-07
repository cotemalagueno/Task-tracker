# Task Tracker · E-Commerce Cheil

Tablero de tareas para el equipo, con subtareas, progreso, línea de tiempo simplificada
y vista de horas restantes. No necesita instalar nada (Node, npm, etc.): es HTML/CSS/JS
puro que corre directo en el navegador, con [Firebase](https://firebase.google.com) como
base de datos gratuita en tiempo real y GitHub Pages para el link público.

## Qué incluye

- **Tablero** estilo kanban (Por hacer / En progreso / Hecho), arrastra y suelta las tarjetas.
- **Subtareas** con checklist — el % de progreso se calcula solo.
- **Línea de tiempo** simplificada (barras por tarea sobre un calendario, sin flechas de
  dependencia ni cruces confusas).
- **Vista de Tiempos**: horas/días restantes hasta la entrega de cada tarea, ordenadas por urgencia.
- **"Login" sin contraseña**: cada persona entra con su nombre + una foto o un emoji.
- Todo se sincroniza en tiempo real entre todo el equipo.

---

## Paso 1 — Crear tu proyecto de Firebase (gratis)

1. Entra a **https://console.firebase.google.com** con tu cuenta de Google.
2. Clic en **"Crear un proyecto"** (o "Add project").
3. Ponle un nombre, por ejemplo `cheil-task-tracker`. Puedes desactivar Google Analytics
   (no lo necesitamos).
4. Espera a que se cree el proyecto.

## Paso 2 — Registrar la app web y copiar la configuración

1. En la pantalla principal del proyecto, clic en el ícono **`</>`** (Web).
2. Ponle un apodo a la app, ej. `task-tracker`. **No** marques "Firebase Hosting".
3. Clic en **"Registrar app"**. Te va a mostrar un bloque de código con `firebaseConfig = {...}`.
4. Copia ese objeto completo.
5. Abre el archivo [`js/firebase-config.js`](js/firebase-config.js) de este proyecto y
   reemplaza el objeto de ejemplo por el que copiaste. Guarda el archivo.

## Paso 3 — Activar la base de datos (Firestore)

1. En el menú lateral de Firebase, ve a **Compilación → Firestore Database**.
2. Clic en **"Crear base de datos"**.
3. Elige **"Modo producción"** y la ubicación más cercana (ej. `southamerica-east1`).
4. Cuando esté creada, ve a la pestaña **"Reglas"** y reemplaza el contenido por esto:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

   Esto permite leer/escribir solo a quien haya "iniciado sesión" en la app (con su
   nombre y foto), no a cualquiera en internet.
5. Clic en **"Publicar"**.

## Paso 4 — Activar el inicio de sesión anónimo

La app no pide contraseña: por dentro usa un inicio de sesión "anónimo" de Firebase para
poder aplicar las reglas de seguridad, pero para tus compañeros esto es invisible —
solo escriben su nombre y eligen foto o emoji.

1. Ve a **Compilación → Authentication**.
2. Clic en **"Comenzar"** / **"Get started"**.
3. En la pestaña **"Sign-in method"**, busca **"Anónimo"** (Anonymous) y actívalo.
4. Guarda.

## Paso 5 — Probar localmente (opcional)

Como la app usa módulos de JavaScript, no puedes abrir `index.html` haciendo doble clic
(el navegador bloquea los módulos en archivos locales `file://`). Este proyecto ya trae
un mini servidor local sin dependencias (`_devserver.ps1`, usa PowerShell que ya viene en
Windows). Para probarlo:

```powershell
powershell -ExecutionPolicy Bypass -File "_devserver.ps1"
```

Y abre `http://localhost:8080` en tu navegador. (Si prefieres, puedes saltarte este paso
y probar directo en GitHub Pages una vez publicado — Paso 7).

## Paso 6 — Subir el proyecto a GitHub

1. Ve a **https://github.com/new** y crea un repositorio:
   - Nombre sugerido: `task-tracker`
   - Puede ser público o privado (si es privado, GitHub Pages sigue funcionando gratis
     en cuentas personales).
   - **No** marques "Add a README" (ya tenemos uno).
2. Copia la URL del repo (ej. `https://github.com/tu-usuario/task-tracker.git`).
3. En una terminal, dentro de esta carpeta:

   ```bash
   git init
   git add .
   git commit -m "Task Tracker inicial"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/task-tracker.git
   git push -u origin main
   ```

## Paso 7 — Activar GitHub Pages

1. En tu repositorio de GitHub, ve a **Settings → Pages**.
2. En "Source", elige la rama **`main`** y la carpeta **`/ (root)`**.
3. Guarda. Espera 1–2 minutos.
4. Tu link quedará como:

   ```
   https://TU-USUARIO.github.io/task-tracker/
   ```

## Paso 8 — Compartir con tu equipo

Envía ese link a tus compañeros de E-Commerce. Cada uno, al entrar, pone su nombre y
elige una foto (se recorta automáticamente) o un emoji — sin contraseñas. Todos verán
las mismas tareas sincronizadas en tiempo real.

---

## Preguntas frecuentes

**¿Cuánto cuesta?**
Firebase (plan Spark) y GitHub Pages son gratis para este tamaño de equipo. El plan
gratuito de Firestore incluye ~50,000 lecturas y 20,000 escrituras al día, más que
suficiente para un equipo trabajando un tablero de tareas.

**¿Cómo agrego más colores o vistas?**
Los colores están definidos en `js/app.js` (constante `COLORS`) y los estilos generales
en `css/styles.css`.

**Cada vez que alguien crea o edita una tarea, ¿tengo que hacer algo?**
No, todo se guarda automáticamente y se sincroniza solo — no hay botón de "publicar".

**¿Puedo cambiar el nombre del equipo o el logo?**
Sí, edita el texto "E-Commerce Cheil" y el emoji ✅ en `index.html`.
