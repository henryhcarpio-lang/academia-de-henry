# Academia de Henry

Biblioteca personal de guías en HTML, publicada en GitHub Pages. Arrastra
una guía, la plataforma la organiza por tema, y queda disponible desde
cualquier navegador — casa, trabajo, celular — entrando siempre a la misma
URL.

## Cómo funciona

- **`index.html` + `assets/`** — la plataforma en sí (biblioteca, buscador, lector, notas).
- **`catalogo.json`** — el índice: títulos, temas, tags, notas y rutas de cada guía. Es el archivo que la app lee y reescribe.
- **`guias/<tema>/archivo.html`** — tus guías, un archivo HTML autocontenido por guía (imágenes incrustadas).

No hay servidor ni base de datos aparte: el propio repositorio de GitHub es el almacenamiento. La página escribe en él usando la API de GitHub.

## Primera vez: publicar el sitio

1. Sube este repositorio a GitHub (público, para que Pages funcione gratis).
2. En GitHub → **Settings → Pages** → Source: rama `main`, carpeta `/ (root)`.
3. Tu biblioteca queda en `https://<tuusuario>.github.io/<nombre-del-repo>/`.

## Primera vez: activar poder subir y editar

Sin token, la página funciona en **modo lectura**: ves y buscas guías desde cualquier lado, pero no puedes subir ni escribir notas.

Para poder escribir:

1. Entra a GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Límitalo a **este repositorio únicamente**.
3. Dale permiso **Contents: Read and write**. Nada más.
4. Copia el token y pégalo en la app: botón ⚙️ (Ajustes) → campo Token → Guardar.

El token se guarda solo en el navegador donde lo pegues (localStorage). No viaja a ningún otro sitio. Si usas otra computadora (por ejemplo, la del trabajo) y prefieres no dejarlo ahí, simplemente no lo pegues — seguirás pudiendo leer y buscar todo.

Para revocar el acceso en cualquier momento: borra el token desde GitHub (Settings → Developer settings → Tokens) o quítalo desde ⚙️ Ajustes → "Quitar acceso".

## Subir una guía

Arrastra un `.html`, una carpeta, o un `.zip` a cualquier parte de la ventana. La plataforma:

1. Detecta si el HTML referencia imágenes externas y, si las encuentra entre lo que soltaste, las incrusta dentro del archivo (queda autocontenido).
2. Propone título, resumen y tema (comparando con lo que ya tienes).
3. Tú confirmas o ajustas, y se guarda.

## Privacidad

El repositorio es público para que GitHub Pages lo publique gratis. Se incluye un `robots.txt` que pide a los buscadores no indexarlo, pero cualquiera con el enlace exacto puede leer el contenido. No subas aquí nada sensible o confidencial.
