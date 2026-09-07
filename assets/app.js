// Academia de Henry — lógica de la plataforma
// Todo corre en el navegador. El catálogo y las guías viven en este mismo
// repositorio de GitHub; para escribir en él usamos la API de GitHub con un
// token que el usuario genera y pega una sola vez (guardado solo en su
// navegador, vía localStorage — nunca sale de esta máquina hacia nosotros).

(() => {
  'use strict';

  // ---------- Configuración del repositorio ----------
  // Se detecta automáticamente a partir de la URL de GitHub Pages
  // (usuario.github.io/repo/...). Si se sirve de otro modo, se puede fijar
  // a mano aquí.
  const REPO = detectarRepo();

  function detectarRepo() {
    const host = location.hostname; // ej. henry.github.io
    const partes = location.pathname.split('/').filter(Boolean);
    if (host.endsWith('.github.io') && partes.length > 0) {
      return { owner: host.replace('.github.io', ''), repo: partes[0] };
    }
    // Fallback para pruebas en local: se pide al usuario en Ajustes.
    const guardado = leerJSON('academia_repo_manual', null);
    return guardado || { owner: '', repo: '' };
  }

  const RAMA = 'main';
  const API = 'https://api.github.com';

  // ---------- Utilidades de almacenamiento local ----------

  function leerJSON(clave, porDefecto) {
    try {
      const v = localStorage.getItem(clave);
      return v ? JSON.parse(v) : porDefecto;
    } catch { return porDefecto; }
  }
  function guardarJSON(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch {}
  }

  function token() { return localStorage.getItem('academia_token') || ''; }
  function setToken(t) {
    if (t) localStorage.setItem('academia_token', t);
    else localStorage.removeItem('academia_token');
    actualizarModoEscritura();
  }
  function puedeEscribir() { return !!token() && !!REPO.owner && !!REPO.repo; }

  // ---------- Cliente mínimo de la API de GitHub (contents API) ----------

  async function ghFetch(ruta, opciones = {}) {
    const resp = await fetch(`${API}${ruta}`, {
      ...opciones,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token()}`,
        ...(opciones.headers || {}),
      },
    });
    if (!resp.ok) {
      const texto = await resp.text().catch(() => '');
      const err = new Error(`GitHub API ${resp.status}: ${texto.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    return resp.status === 204 ? null : resp.json();
  }

  // Lee un archivo del repo. Devuelve { contenido, sha } o null si no existe.
  async function leerArchivoRepo(ruta) {
    try {
      const datos = await ghFetch(`/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURI(ruta)}?ref=${RAMA}`);
      const contenido = decodeURIComponent(escape(atob(datos.content.replace(/\n/g, ''))));
      return { contenido, sha: datos.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // Crea o actualiza un archivo en el repo.
  async function escribirArchivoRepo(ruta, contenidoTexto, mensaje, shaPrevio) {
    const b64 = btoa(unescape(encodeURIComponent(contenidoTexto)));
    const cuerpo = { message: mensaje, content: b64, branch: RAMA };
    if (shaPrevio) cuerpo.sha = shaPrevio;
    return ghFetch(`/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURI(ruta)}`, {
      method: 'PUT',
      body: JSON.stringify(cuerpo),
    });
  }

  async function borrarArchivoRepo(ruta, mensaje, sha) {
    return ghFetch(`/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURI(ruta)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: mensaje, sha, branch: RAMA }),
    });
  }

  // ---------- Estado de la app ----------

  const estado = {
    catalogo: { temas: [], guias: [] },
    shaCatalogo: null,
    filtroTema: 'todos',
    busqueda: '',
    guiaAbierta: null,
    cargando: false,
  };

  const TEMAS_INICIALES = [
    { id: 'general', nombre: 'General', color: '#8a8579' },
  ];

  // ---------- Carga inicial del catálogo ----------

  async function cargarCatalogo() {
    // 1) intenta el archivo publicado (rápido, funciona sin token)
    try {
      const resp = await fetch(`catalogo.json?_=${Date.now()}`, { cache: 'no-store' });
      if (resp.ok) {
        estado.catalogo = await resp.json();
      }
    } catch {}

    // 2) si hay token, confirma contra el repo (por si hay cambios frescos
    //    hechos desde otro dispositivo) y guarda el sha para poder escribir.
    if (puedeEscribir()) {
      try {
        const remoto = await leerArchivoRepo('catalogo.json');
        if (remoto) {
          estado.catalogo = JSON.parse(remoto.contenido);
          estado.shaCatalogo = remoto.sha;
        }
      } catch (e) {
        avisar('No se pudo confirmar el catálogo remoto: ' + e.message, true);
      }
    }

    if (!estado.catalogo.temas || estado.catalogo.temas.length === 0) {
      estado.catalogo.temas = TEMAS_INICIALES;
    }
    if (!estado.catalogo.guias) estado.catalogo.guias = [];

    renderFiltros();
    renderRejilla();
  }

  async function guardarCatalogo(mensaje) {
    if (!puedeEscribir()) {
      avisar('Sin acceso de escritura: activa el token en Ajustes para guardar cambios.', true);
      return false;
    }
    try {
      const resultado = await escribirArchivoRepo(
        'catalogo.json',
        JSON.stringify(estado.catalogo, null, 2),
        mensaje,
        estado.shaCatalogo
      );
      estado.shaCatalogo = resultado.content.sha;
      return true;
    } catch (e) {
      avisar('Error guardando el catálogo: ' + e.message, true);
      return false;
    }
  }

  // ---------- Avisos ----------

  let avisoTimer = null;
  function avisar(texto, esError = false) {
    const el = document.getElementById('aviso');
    el.textContent = texto;
    el.classList.toggle('error', esError);
    el.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { el.hidden = true; }, esError ? 5000 : 2800);
  }

  // ---------- Render: filtros por tema ----------

  function renderFiltros() {
    const cont = document.getElementById('filtros');
    cont.innerHTML = '';

    const total = estado.catalogo.guias.length;
    cont.appendChild(chip('todos', 'Todas', null, total));

    for (const t of estado.catalogo.temas) {
      const n = estado.catalogo.guias.filter(g => g.tema === t.id).length;
      cont.appendChild(chip(t.id, t.nombre, t.color, n));
    }
  }

  function chip(id, nombre, color, conteo) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(estado.filtroTema === id));
    b.innerHTML = (color ? `<span class="chip-punto" style="background:${color}"></span>` : '') +
      `<span>${escapeHtml(nombre)}</span><span class="chip-conteo">${conteo}</span>`;
    b.addEventListener('click', () => {
      estado.filtroTema = id;
      renderFiltros();
      renderRejilla();
    });
    return b;
  }

  // ---------- Render: rejilla de tarjetas ----------

  function guiasFiltradas() {
    const q = estado.busqueda.trim().toLowerCase();
    return estado.catalogo.guias
      .filter(g => estado.filtroTema === 'todos' || g.tema === estado.filtroTema)
      .filter(g => {
        if (!q) return true;
        const campo = [g.titulo, g.resumen, g.nota, ...(g.tags || [])].join(' ').toLowerCase();
        return campo.includes(q);
      })
      .sort((a, b) => (b.fechaSubida || '').localeCompare(a.fechaSubida || ''));
  }

  function temaPorId(id) {
    return estado.catalogo.temas.find(t => t.id === id) || { nombre: 'Sin tema', color: '#999' };
  }

  function renderRejilla() {
    const rejilla = document.getElementById('rejilla');
    const vacio = document.getElementById('vacio');
    const lista = guiasFiltradas();

    rejilla.innerHTML = '';

    if (estado.catalogo.guias.length === 0) {
      vacio.hidden = false;
      rejilla.hidden = true;
      return;
    }
    vacio.hidden = true;
    rejilla.hidden = false;

    if (lista.length === 0) {
      const p = document.createElement('p');
      p.style.color = 'var(--texto-suave)';
      p.textContent = 'Ninguna guía coincide con el filtro o la búsqueda.';
      rejilla.appendChild(p);
      return;
    }

    for (const g of lista) {
      const tema = temaPorId(g.tema);
      const tarjeta = document.createElement('button');
      tarjeta.className = 'tarjeta';
      tarjeta.innerHTML = `
        <span class="tarjeta-tema"><span class="chip-punto" style="background:${tema.color}"></span>${escapeHtml(tema.nombre)}</span>
        <h3>${escapeHtml(g.titulo)}</h3>
        <p class="tarjeta-resumen">${escapeHtml(g.resumen || 'Sin resumen.')}</p>
        <div class="tarjeta-pie">
          <span>${fechaCorta(g.fechaSubida)}</span>
          <div class="tarjeta-tags">${(g.tags || []).slice(0, 3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          ${g.nota ? '<span class="tarjeta-nota" title="Tiene nota">✎</span>' : ''}
        </div>`;
      tarjeta.addEventListener('click', () => abrirLector(g));
      rejilla.appendChild(tarjeta);
    }
  }

  function fechaCorta(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Lector ----------

  let notaTimer = null;

  async function abrirLector(guia) {
    estado.guiaAbierta = guia;
    const tema = temaPorId(guia.tema);

    document.getElementById('lector-nombre').textContent = guia.titulo;
    document.getElementById('lector-tema').textContent = tema.nombre;
    document.getElementById('panel-notas').hidden = true;
    document.getElementById('nota-texto').value = guia.nota || '';
    document.getElementById('nota-estado').textContent = '';
    document.getElementById('lector').hidden = false;

    const marco = document.getElementById('lector-marco');
    marco.srcdoc = 'Cargando…';

    try {
      let html;
      if (puedeEscribir()) {
        const archivo = await leerArchivoRepo(guia.ruta);
        html = archivo ? archivo.contenido : null;
      }
      if (!html) {
        const resp = await fetch(guia.ruta + `?_=${Date.now()}`);
        html = await resp.text();
      }
      marco.srcdoc = html;
    } catch (e) {
      marco.srcdoc = `<p style="font-family:sans-serif;padding:20px">No se pudo cargar la guía: ${escapeHtml(e.message)}</p>`;
    }

    guia.fechaUltimaLectura = new Date().toISOString();
    guardarCatalogo(`Lectura: ${guia.titulo}`); // silencioso si falla
  }

  function cerrarLector() {
    document.getElementById('lector').hidden = true;
    document.getElementById('lector-marco').srcdoc = '';
    estado.guiaAbierta = null;
    renderRejilla();
  }

  function alternarNotas() {
    const panel = document.getElementById('panel-notas');
    panel.hidden = !panel.hidden;
  }

  function programarGuardadoNota() {
    const estadoEl = document.getElementById('nota-estado');
    estadoEl.textContent = 'Escribiendo…';
    clearTimeout(notaTimer);
    notaTimer = setTimeout(async () => {
      const guia = estado.guiaAbierta;
      if (!guia) return;
      guia.nota = document.getElementById('nota-texto').value;
      const ok = await guardarCatalogo(`Nota: ${guia.titulo}`);
      estadoEl.textContent = ok ? 'Guardado ✓' : 'No se pudo guardar (revisa el acceso en Ajustes)';
    }, 900);
  }

  async function descargarGuiaActual() {
    const guia = estado.guiaAbierta;
    if (!guia) return;
    let html = document.getElementById('lector-marco').srcdoc;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (guia.titulo || 'guia').replace(/[^\w\-]+/g, '_') + '.html';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function borrarGuiaActual() {
    const guia = estado.guiaAbierta;
    if (!guia) return;
    if (!puedeEscribir()) { avisar('Necesitas acceso de escritura para eliminar (ver Ajustes).', true); return; }
    if (!confirm(`¿Eliminar "${guia.titulo}"? Esto borra también el archivo del repositorio.`)) return;

    try {
      const archivo = await leerArchivoRepo(guia.ruta);
      if (archivo) await borrarArchivoRepo(guia.ruta, `Eliminar guía: ${guia.titulo}`, archivo.sha);
      estado.catalogo.guias = estado.catalogo.guias.filter(g => g.id !== guia.id);
      await guardarCatalogo(`Eliminar del catálogo: ${guia.titulo}`);
      cerrarLector();
      avisar('Guía eliminada.');
    } catch (e) {
      avisar('No se pudo eliminar: ' + e.message, true);
    }
  }

  // ---------- Modal genérico ----------

  function abrirModal(html) {
    document.getElementById('modal-caja').innerHTML = html;
    document.getElementById('modal').hidden = false;
  }
  function cerrarModal() {
    document.getElementById('modal').hidden = true;
    document.getElementById('modal-caja').innerHTML = '';
  }

  // ---------- Ajustes (token de escritura) ----------

  function abrirAjustes() {
    abrirModal(`
      <h2>Acceso de escritura</h2>
      <p>Para subir guías, escribir notas o borrar, esta página necesita un token
      personal de GitHub con permiso solo sobre este repositorio. Se guarda
      únicamente en este navegador (localStorage) — nunca se envía a ningún
      sitio salvo a la propia API de GitHub.</p>

      ${!REPO.owner ? `
      <div class="campo">
        <label>Usuario / organización de GitHub</label>
        <input id="in-owner" type="text" placeholder="tuusuario">
      </div>
      <div class="campo">
        <label>Nombre del repositorio</label>
        <input id="in-repo" type="text" placeholder="academia-de-henry">
      </div>` : `<p class="campo-ayuda">Repositorio detectado: <b>${escapeHtml(REPO.owner)}/${escapeHtml(REPO.repo)}</b></p>`}

      <div class="campo">
        <label>Token (github.com → Settings → Developer settings → Fine-grained tokens)</label>
        <input id="in-token" type="password" placeholder="github_pat_…" value="${token() ? '••••••••••••' : ''}">
        <p class="campo-ayuda">Dále permiso "Contents: Read and write" solo sobre este repositorio. Si dejas el campo con puntos, no se cambia el token guardado.</p>
      </div>

      <div class="modal-pie">
        ${token() ? '<button class="btn" id="btn-quitar-token">Quitar acceso</button>' : ''}
        <button class="btn" id="btn-cancelar-ajustes">Cancelar</button>
        <button class="btn btn-principal" id="btn-guardar-ajustes">Guardar</button>
      </div>
    `);

    document.getElementById('btn-cancelar-ajustes').onclick = cerrarModal;
    document.getElementById('btn-quitar-token')?.addEventListener('click', () => {
      setToken('');
      cerrarModal();
      avisar('Acceso de escritura quitado. Quedas en modo lectura.');
    });
    document.getElementById('btn-guardar-ajustes').onclick = async () => {
      if (!REPO.owner) {
        const owner = document.getElementById('in-owner').value.trim();
        const repo = document.getElementById('in-repo').value.trim();
        if (owner && repo) {
          REPO.owner = owner; REPO.repo = repo;
          guardarJSON('academia_repo_manual', { owner, repo });
        }
      }
      const t = document.getElementById('in-token').value.trim();
      if (t && !t.startsWith('••')) setToken(t);
      cerrarModal();
      avisar('Ajustes guardados.');
      cargarCatalogo();
    };
  }

  function actualizarModoEscritura() {
    const btnSubir = document.getElementById('btn-subir');
    const btnSubirVacio = document.getElementById('btn-vacio-subir');
    const activo = puedeEscribir();
    [btnSubir, btnSubirVacio].forEach(b => { if (b) b.title = activo ? '' : 'Necesitas acceso de escritura (⚙️ Ajustes)'; });
  }

  // ---------- Gestión de temas ----------

  function abrirGestionTemas() {
    render();
    function render() {
      const filas = estado.catalogo.temas.map(t => {
        const n = estado.catalogo.guias.filter(g => g.tema === t.id).length;
        return `<div class="fila-tema" data-id="${t.id}">
          <input type="color" value="${t.color}" data-campo="color">
          <input type="text" value="${escapeHtml(t.nombre)}" data-campo="nombre">
          <span class="fila-tema-conteo">${n} guía${n === 1 ? '' : 's'}</span>
          <button class="btn btn-icono btn-peligro" data-accion="borrar" ${n > 0 ? 'disabled title="Reasigna sus guías antes de borrarlo"' : ''}>🗑</button>
        </div>`;
      }).join('');

      abrirModal(`
        <h2>Temas</h2>
        <p>Crea los espacios donde se organizan tus guías.</p>
        <div class="lista-temas" id="lista-temas">${filas}</div>
        <button class="btn" id="btn-nuevo-tema">+ Nuevo tema</button>
        <div class="modal-pie">
          <button class="btn" id="btn-cerrar-temas">Cerrar</button>
        </div>
      `);

      document.getElementById('btn-cerrar-temas').onclick = cerrarModal;
      document.getElementById('btn-nuevo-tema').onclick = () => {
        const id = 'tema-' + Date.now().toString(36);
        estado.catalogo.temas.push({ id, nombre: 'Nuevo tema', color: colorAleatorio() });
        render();
      };
      document.querySelectorAll('#lista-temas .fila-tema').forEach(fila => {
        const id = fila.dataset.id;
        const tema = estado.catalogo.temas.find(t => t.id === id);
        fila.querySelector('[data-campo="nombre"]').addEventListener('change', e => { tema.nombre = e.target.value; });
        fila.querySelector('[data-campo="color"]').addEventListener('change', e => { tema.color = e.target.value; });
        fila.querySelector('[data-accion="borrar"]').addEventListener('click', () => {
          estado.catalogo.temas = estado.catalogo.temas.filter(t => t.id !== id);
          render();
        });
      });
      // Reemplaza el botón guardar del pie por uno propio
      const pie = document.querySelector('#modal-caja .modal-pie');
      const btnGuardar = document.createElement('button');
      btnGuardar.className = 'btn btn-principal';
      btnGuardar.textContent = 'Guardar';
      btnGuardar.onclick = async () => {
        const ok = await guardarCatalogo('Actualizar temas');
        if (ok) { cerrarModal(); renderFiltros(); renderRejilla(); avisar('Temas guardados.'); }
      };
      pie.appendChild(btnGuardar);
    }
  }

  function colorAleatorio() {
    const paleta = ['#b5502a', '#3a6b5a', '#4a5a8a', '#8a6a3a', '#7a4a7a', '#3a7a8a'];
    return paleta[Math.floor(Math.random() * paleta.length)];
  }

  // ---------- Apariencia (claro/oscuro) ----------

  function alternarApariencia() {
    const actual = document.documentElement.getAttribute('data-apariencia');
    const siguiente = actual === 'oscuro' ? 'claro' : (actual === 'claro' ? null : 'oscuro');
    if (siguiente) document.documentElement.setAttribute('data-apariencia', siguiente);
    else document.documentElement.removeAttribute('data-apariencia');
    guardarJSON('academia_apariencia', siguiente);
  }

  function aplicarAparienciaGuardada() {
    const guardada = leerJSON('academia_apariencia', null);
    if (guardada) document.documentElement.setAttribute('data-apariencia', guardada);
  }

  // ---------- Ingesta de archivos: extracción y detección ----------

  // Convierte una FileList / lista de File (posiblemente con rutas de
  // carpeta vía webkitRelativePath) en "paquetes": cada paquete es un HTML
  // más sus archivos de apoyo (imágenes, css) que referencia.
  async function agruparArchivos(archivos) {
    const htmls = archivos.filter(f => /\.html?$/i.test(f.name));
    const otros = archivos.filter(f => !/\.html?$/i.test(f.name));

    const paquetes = [];
    for (const html of htmls) {
      const carpetaBase = carpetaDe(html.webkitRelativePath || html.name);
      const acompanantes = otros.filter(o => carpetaDe(o.webkitRelativePath || o.name) === carpetaBase
        || (o.webkitRelativePath || '').startsWith(carpetaBase + '/'));
      paquetes.push({ html, acompanantes });
    }
    return paquetes;
  }

  function carpetaDe(ruta) {
    const i = ruta.lastIndexOf('/');
    return i === -1 ? '' : ruta.slice(0, i);
  }

  async function leerComoTexto(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsText(file);
    });
  }
  async function leerComoDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // Incrusta imágenes/CSS externos referenciados por src= o href= dentro
  // del HTML, usando los archivos acompañantes disponibles. Lo que no
  // encuentra, lo deja igual (y lo reporta).
  async function incrustarAcompanantes(htmlTexto, acompanantes) {
    const faltantes = [];
    const mapa = new Map(acompanantes.map(f => [nombreCorto(f.webkitRelativePath || f.name), f]));

    const regex = /(src|href)=["']([^"':][^"']*)["']/g;
    const coincidencias = [...htmlTexto.matchAll(regex)];
    let resultado = htmlTexto;

    for (const m of coincidencias) {
      const [completo, atributo, ruta] = m;
      if (/^(https?:|data:|#|mailto:)/i.test(ruta)) continue; // ya son externos o anclas
      const archivo = mapa.get(nombreCorto(ruta));
      if (!archivo) { faltantes.push(ruta); continue; }
      try {
        const dataUrl = await leerComoDataURL(archivo);
        resultado = resultado.split(completo).join(`${atributo}="${dataUrl}"`);
      } catch {
        faltantes.push(ruta);
      }
    }
    return { html: resultado, faltantes: [...new Set(faltantes)] };
  }

  function nombreCorto(ruta) {
    return ruta.split('/').pop();
  }

  function extraerMetadatos(htmlTexto) {
    const doc = new DOMParser().parseFromString(htmlTexto, 'text/html');
    const titulo = (doc.querySelector('title')?.textContent
      || doc.querySelector('h1')?.textContent
      || '').trim();
    const textoPlano = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
    const resumen = textoPlano.slice(0, 220);
    return { titulo, resumen, textoPlano };
  }

  // Sugiere un tema comparando palabras del contenido contra las guías
  // existentes de cada tema (sin IA: solo coincidencia de términos).
  function sugerirTema(textoPlano) {
    const palabras = new Set(
      textoPlano.toLowerCase().match(/[a-záéíóúñü]{5,}/g) || []
    );
    if (palabras.size === 0 || estado.catalogo.guias.length === 0) return null;

    let mejor = null, mejorPuntaje = 0;
    for (const tema of estado.catalogo.temas) {
      const guiasTema = estado.catalogo.guias.filter(g => g.tema === tema.id);
      if (guiasTema.length === 0) continue;
      const corpus = guiasTema.map(g => (g.titulo + ' ' + (g.resumen || '') + ' ' + (g.tags || []).join(' ')).toLowerCase()).join(' ');
      let puntaje = 0;
      for (const p of palabras) if (corpus.includes(p)) puntaje++;
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = tema; }
    }
    return mejorPuntaje >= 2 ? mejor : null;
  }

  // ---------- Flujo de subida ----------

  let pendientesGlobal = [];

  async function iniciarSubida(archivos) {
    if (!puedeEscribir()) {
      avisar('Necesitas acceso de escritura para subir guías (⚙️ Ajustes).', true);
      abrirAjustes();
      return;
    }
    const paquetes = await agruparArchivos(archivos);
    if (paquetes.length === 0) {
      avisar('No se encontró ningún archivo .html en lo que soltaste.', true);
      return;
    }

    pendientesGlobal = [];
    for (const paquete of paquetes) {
      const textoOriginal = await leerComoTexto(paquete.html);
      const { html, faltantes } = paquete.acompanantes.length
        ? await incrustarAcompanantes(textoOriginal, paquete.acompanantes)
        : { html: textoOriginal, faltantes: [] };
      const meta = extraerMetadatos(html);
      const temaSugerido = sugerirTema(meta.textoPlano);
      pendientesGlobal.push({
        nombreArchivo: paquete.html.name,
        html,
        titulo: meta.titulo || paquete.html.name.replace(/\.html?$/i, ''),
        resumen: meta.resumen,
        temaSugerido,
        temaElegido: temaSugerido?.id || estado.catalogo.temas[0]?.id || '',
        tags: '',
        faltantes,
      });
    }
    mostrarModalConfirmacion();
  }

  function mostrarModalConfirmacion() {
    const opcionesTema = estado.catalogo.temas.map(t => `<option value="${t.id}">${escapeHtml(t.nombre)}</option>`).join('');

    const bloques = pendientesGlobal.map((p, i) => `
      <div class="pendiente" data-i="${i}">
        <div class="pendiente-cabecera">
          <strong>Guía ${i + 1} de ${pendientesGlobal.length}</strong>
          <span class="pendiente-archivo">${escapeHtml(p.nombreArchivo)}</span>
        </div>
        ${p.faltantes.length ? `<p class="campo-ayuda" style="color:var(--peligro)">⚠ No se encontraron: ${p.faltantes.map(escapeHtml).join(', ')}. Se guardará igual, pero esas imágenes no se verán.</p>` : ''}
        <div class="campo">
          <label>Título</label>
          <input type="text" data-campo="titulo" value="${escapeHtml(p.titulo)}">
        </div>
        <div class="doble">
          <div class="campo">
            <label>Tema</label>
            <select data-campo="tema">${opcionesTema}</select>
            ${p.temaSugerido ? `<p class="sugerencia">Sugerido: ${escapeHtml(p.temaSugerido.nombre)}</p>` : ''}
          </div>
          <div class="campo">
            <label>Tags (separados por coma)</label>
            <input type="text" data-campo="tags" placeholder="prompts, difusión">
          </div>
        </div>
        <div class="campo">
          <label>Resumen</label>
          <textarea data-campo="resumen" rows="2">${escapeHtml(p.resumen)}</textarea>
        </div>
      </div>
    `).join('');

    abrirModal(`
      <h2>Confirmar subida</h2>
      <p>Revisa título, tema y tags antes de guardar en tu biblioteca.</p>
      <div class="pendientes">${bloques}</div>
      <div class="modal-pie">
        <button class="btn" id="btn-cancelar-subida">Cancelar</button>
        <button class="btn btn-principal" id="btn-confirmar-subida">Guardar en la biblioteca</button>
      </div>
    `);

    document.querySelectorAll('.pendiente').forEach(bloque => {
      const i = Number(bloque.dataset.i);
      bloque.querySelector('[data-campo="tema"]').value = pendientesGlobal[i].temaElegido;
      bloque.querySelector('[data-campo="titulo"]').addEventListener('input', e => pendientesGlobal[i].titulo = e.target.value);
      bloque.querySelector('[data-campo="tema"]').addEventListener('change', e => pendientesGlobal[i].temaElegido = e.target.value);
      bloque.querySelector('[data-campo="tags"]').addEventListener('input', e => pendientesGlobal[i].tags = e.target.value);
      bloque.querySelector('[data-campo="resumen"]').addEventListener('input', e => pendientesGlobal[i].resumen = e.target.value);
    });

    document.getElementById('btn-cancelar-subida').onclick = () => { pendientesGlobal = []; cerrarModal(); };
    document.getElementById('btn-confirmar-subida').onclick = confirmarSubida;
  }

  async function confirmarSubida() {
    const boton = document.getElementById('btn-confirmar-subida');
    boton.disabled = true;
    boton.textContent = 'Guardando…';

    let subidas = 0;
    for (const p of pendientesGlobal) {
      try {
        const id = 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const nombreArchivo = sanear(p.titulo) + '.html';
        const ruta = `guias/${sanear(temaPorId(p.temaElegido).nombre)}/${nombreArchivo}`;

        await escribirArchivoRepo(ruta, p.html, `Subir guía: ${p.titulo}`);

        estado.catalogo.guias.push({
          id,
          titulo: p.titulo,
          tema: p.temaElegido,
          resumen: p.resumen,
          tags: p.tags.split(',').map(t => t.trim()).filter(Boolean),
          ruta,
          nota: '',
          fechaSubida: new Date().toISOString(),
          fechaUltimaLectura: null,
        });
        subidas++;
      } catch (e) {
        avisar(`Error subiendo "${p.titulo}": ${e.message}`, true);
      }
    }

    if (subidas > 0) {
      await guardarCatalogo(`Añadir ${subidas} guía(s) al catálogo`);
      avisar(`${subidas} guía(s) guardada(s).`);
    }
    pendientesGlobal = [];
    cerrarModal();
    renderFiltros();
    renderRejilla();
  }

  function sanear(texto) {
    return (texto || 'sin-titulo')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'guia';
  }

  // ---------- Arrastrar y soltar ----------

  function recopilarArchivosDeItems(items) {
    // Soporta arrastrar carpetas (webkitGetAsEntry) además de archivos sueltos.
    const promesas = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) promesas.push(leerEntry(entry, ''));
      else {
        const f = item.getAsFile?.();
        if (f) promesas.push(Promise.resolve([f]));
      }
    }
    return Promise.all(promesas).then(listas => listas.flat());
  }

  function leerEntry(entry, prefijo) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(f => {
          try { Object.defineProperty(f, 'webkitRelativePath', { value: prefijo + f.name }); } catch {}
          resolve([f]);
        }, () => resolve([]));
      } else if (entry.isDirectory) {
        const lector = entry.createReader();
        const todos = [];
        const leerLote = () => {
          lector.readEntries(async (entries) => {
            if (entries.length === 0) {
              const listas = await Promise.all(todos);
              resolve(listas.flat());
              return;
            }
            for (const e of entries) todos.push(leerEntry(e, prefijo + entry.name + '/'));
            leerLote();
          }, () => resolve([]));
        };
        leerLote();
      } else resolve([]);
    });
  }

  function configurarArrastre() {
    const capa = document.getElementById('soltar');
    let contador = 0;

    window.addEventListener('dragenter', e => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      contador++;
      capa.hidden = false;
    });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('dragleave', () => {
      contador = Math.max(0, contador - 1);
      if (contador === 0) capa.hidden = true;
    });
    window.addEventListener('drop', async e => {
      e.preventDefault();
      contador = 0;
      capa.hidden = true;
      if (!e.dataTransfer?.items?.length) return;
      const archivos = await recopilarArchivosDeItems([...e.dataTransfer.items]);
      // Filtra zips: los descomprimimos si hace falta (requiere JSZip por CDN).
      const zips = archivos.filter(f => /\.zip$/i.test(f.name));
      const normales = archivos.filter(f => !/\.zip$/i.test(f.name));
      let extraidos = [];
      for (const z of zips) extraidos = extraidos.concat(await extraerZip(z));
      iniciarSubida([...normales, ...extraidos]);
    });
  }

  async function extraerZip(file) {
    if (!window.JSZip) {
      avisar('No se pudo leer el .zip (falta la librería). Prueba arrastrando la carpeta directamente.', true);
      return [];
    }
    const zip = await window.JSZip.loadAsync(file);
    const resultado = [];
    for (const [ruta, entrada] of Object.entries(zip.files)) {
      if (entrada.dir) continue;
      const blob = await entrada.async('blob');
      const f = new File([blob], nombreCorto(ruta), { type: blob.type });
      try { Object.defineProperty(f, 'webkitRelativePath', { value: ruta }); } catch {}
      resultado.push(f);
    }
    return resultado;
  }

  function configurarSelectorManual() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.html,.htm,.zip';
    input.style.display = 'none';
    input.webkitdirectory = false;
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const archivos = [...input.files];
      const zips = archivos.filter(f => /\.zip$/i.test(f.name));
      const normales = archivos.filter(f => !/\.zip$/i.test(f.name));
      let extraidos = [];
      for (const z of zips) extraidos = extraidos.concat(await extraerZip(z));
      iniciarSubida([...normales, ...extraidos]);
      input.value = '';
    });
    return input;
  }

  // ---------- Arranque ----------

  function conectarEventos() {
    document.getElementById('busqueda').addEventListener('input', e => {
      estado.busqueda = e.target.value;
      renderRejilla();
    });
    document.getElementById('btn-ajustes').addEventListener('click', abrirAjustes);
    document.getElementById('btn-temas').addEventListener('click', abrirGestionTemas);
    document.getElementById('btn-tema-visual').addEventListener('click', alternarApariencia);

    const inputManual = configurarSelectorManual();
    document.getElementById('btn-subir').addEventListener('click', () => inputManual.click());
    document.getElementById('btn-vacio-subir').addEventListener('click', () => inputManual.click());

    document.getElementById('lector-volver').addEventListener('click', cerrarLector);
    document.getElementById('lector-notas').addEventListener('click', alternarNotas);
    document.getElementById('lector-descargar').addEventListener('click', descargarGuiaActual);
    document.getElementById('lector-borrar').addEventListener('click', borrarGuiaActual);
    document.getElementById('nota-texto').addEventListener('input', programarGuardadoNota);

    document.getElementById('modal').addEventListener('click', e => {
      if (e.target.id === 'modal') cerrarModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!document.getElementById('modal').hidden) cerrarModal();
        else if (!document.getElementById('lector').hidden) cerrarLector();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    aplicarAparienciaGuardada();
    conectarEventos();
    configurarArrastre();
    actualizarModoEscritura();
    cargarCatalogo();
    if (!REPO.owner) {
      avisar('No se detectó el repositorio. Configúralo en Ajustes (⚙️).', true);
    }
  });
})();
