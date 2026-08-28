(function () {
  'use strict';

  var SUPABASE = 'https://gxjzwyickfrqxnhaajwv.supabase.co';
  var API_KEY = 'sb_publishable_1PB5Th-ci7WU22PhPRFimg_usyfrysE';
  var RESTAURANT_ID = 'c1784a9e-8edf-48b5-86dc-bb9851a9c09d';
  var MEMBER_KEY = '@almibar_member';
  var CONSENT_KEY = '@almibar_data_consent';

  function api(path, options) {
    var headers = Object.assign({ apikey: API_KEY, Authorization: 'Bearer ' + API_KEY }, options && options.headers);
    return fetch(SUPABASE + path, Object.assign({}, options || {}, { headers: headers }));
  }

  function readMember() {
    try { return JSON.parse(localStorage.getItem(MEMBER_KEY) || 'null'); } catch (_) { return null; }
  }

  function consentAccepted() {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); } catch (_) { return null; }
  }

  function saveConsent(mode, member) {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ mode: mode, acceptedAt: new Date().toISOString() }));
    if (member) localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
    localStorage.setItem('@almibar_guest', mode === 'guest' ? 'true' : 'false');
  }

  function parseMember(row, phone) {
    var notes = row.notes || '';
    var memberId = (notes.match(/Member:\s*(ALM-[A-Z0-9]+)/) || [])[1] || '';
    var rut = (notes.match(/(?:RUT:\s*)?([\d.-]+[kK]?)/) || [])[1] || '';
    return {
      clientId: row.id,
      nombre: row.name || 'Socio Almíbar',
      celular: row.phone || phone,
      rut: rut,
      email: row.email || '',
      fechaNac: row.birthday || '',
      memberId: memberId,
      visitas: row.total_visits || 0,
      premios: row.rewards_claimed || 0,
      tier: row.tier || 'normal',
      vipExpiresAt: row.vip_expires_at || null,
      isVip: row.tier === 'vip'
    };
  }


  // ---------- Premio del Club: verlo, elegirlo y canjearlo ----------
  // El backend ya estaba listo (find_member_by_rut entrega reward_available y
  // redeem_reward canjea). Lo que faltaba era esto: una forma de que el socio
  // se entere y elija. Sin este bloque el premio se gana y nadie lo ve.
  var REWARD_CHOICES = ['Mojito Cubano', 'Schop Patagonia Hoppy', 'Mistral 35'];
  var REDEEM_REASONS = {
    socio_invalido: 'No pudimos identificarte como socio. Vuelve a ingresar con tu RUT.',
    identidad_invalida: 'No pudimos verificar tu identidad. Pídele al equipo que revise el teléfono de tu ficha.',
    eleccion_invalida: 'Esa opción no está disponible. Elige una de las tres.',
    mesa_sin_cuenta: 'Esa mesa todavía no tiene cuenta abierta. Pídele al garzón que la abra y vuelve a intentar.',
    sin_premio: 'No tienes premios disponibles en este momento.'
  };

  // El socio guardado en localStorage envejece: un premio ganado ayer no
  // aparecería hasta marcar otra visita. Se refresca contra el servidor.
  async function refreshMemberState(member) {
    if (!member || !member.rut) return member;
    try {
      var fresh = await findMember(member.celular || '', member.rut);
      if (fresh) { localStorage.setItem(MEMBER_KEY, JSON.stringify(fresh)); return fresh; }
    } catch (_) { /* si falla, seguimos con lo que había */ }
    return member;
  }

  function formatCLP(n) {
    return '$' + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // Ahorro acumulado. Se muestra en pesos y NUNCA como porcentaje: el % refuerza
  // que el precio de lista es alto, que es justo lo que no conviene comunicar.
  // Si es 0 no se pinta: a un socio nuevo "llevas $0 ahorrados" lo desinfla.
  function renderSavings(member) {
    var card = document.querySelector('[data-member-card]');
    if (!card) return;
    var prev = card.querySelector('[data-member-saved]');
    if (prev) prev.remove();
    if (!member || !member.totalSaved || member.totalSaved <= 0) return;
    var el = document.createElement('div');
    el.className = 'member-saved';
    el.setAttribute('data-member-saved', '');
    el.innerHTML = '<span class="member-saved-label">Ahorrado como socio</span>' +
                   '<strong class="member-saved-amount">' + formatCLP(member.totalSaved) + '</strong>';
    var meta = card.querySelector('.member-card-meta');
    if (meta && meta.parentNode) meta.parentNode.insertBefore(el, meta.nextSibling);
    else card.appendChild(el);
  }

  function renderRewardBlock(member) {
    var card = document.querySelector('[data-member-card]');
    if (!card) return;
    var prev = card.querySelector('[data-reward-cta]');
    if (prev) prev.remove();
    if (!member || !member.rewardAvailable) return;

    var n = member.rewardsAvailable || 1;
    var box = document.createElement('div');
    box.className = 'reward-cta';
    box.setAttribute('data-reward-cta', '');
    box.innerHTML =
      '<strong>&#127873; ' + (n > 1 ? 'Tienes ' + n + ' premios esperando' : 'Tienes un premio esperando') + '</strong>' +
      '<span>Elígelo y te lo llevamos a la mesa, sin costo.</span>' +
      '<button type="button" class="reward-cta-btn" data-reward-open>Elegir mi premio</button>';
    var note = card.querySelector('.member-card-note');
    if (note) card.insertBefore(box, note); else card.appendChild(box);
    box.querySelector('[data-reward-open]').addEventListener('click', function () { openRedeemModal(member); });
  }

  function openRedeemModal(member) {
    var old = document.querySelector('[data-reward-modal]');
    if (old) old.remove();

    var wrap = document.createElement('div');
    wrap.className = 'reward-modal';
    wrap.setAttribute('data-reward-modal', '');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Elegir tu premio del Club');

    var opciones = REWARD_CHOICES.map(function (c, i) {
      return '<label class="reward-opt">' +
        '<input type="radio" name="reward-choice" value="' + c + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span>' + c + '</span></label>';
    }).join('');

    wrap.innerHTML =
      '<div class="reward-modal-box">' +
        '<button type="button" class="reward-close" data-reward-close aria-label="Cerrar">&times;</button>' +
        '<div class="reward-modal-kicker">Premio del Club</div>' +
        '<h3 class="reward-modal-title">Elige tu premio</h3>' +
        '<p class="reward-modal-sub">Va sin costo a tu cuenta. Tienes que estar en el local con tu mesa abierta.</p>' +
        '<div class="reward-opts">' + opciones + '</div>' +
        '<label class="reward-table">Número de tu mesa' +
          '<input type="number" inputmode="numeric" min="1" step="1" data-reward-table placeholder="Ej: 12">' +
        '</label>' +
        '<button type="button" class="reward-submit" data-reward-submit>Canjear premio</button>' +
        '<p class="reward-status" data-reward-status role="status" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(wrap);

    function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.querySelector('[data-reward-close]').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('[data-reward-submit]').addEventListener('click', function () { doRedeem(member, wrap, close); });
    var tableInput = wrap.querySelector('[data-reward-table]');
    if (tableInput) tableInput.focus();
  }

  async function doRedeem(member, wrap, close) {
    var statusEl = wrap.querySelector('[data-reward-status]');
    var btn = wrap.querySelector('[data-reward-submit]');
    var mesa = parseInt((wrap.querySelector('[data-reward-table]') || {}).value, 10);
    var choiceEl = wrap.querySelector('input[name="reward-choice"]:checked');
    if (!choiceEl) { statusEl.textContent = 'Elige uno de los tres premios.'; statusEl.className = 'reward-status err'; return; }
    if (!mesa || mesa < 1) {
      statusEl.textContent = 'Escribe el número de tu mesa (lo ves en el mantel o pregúntale al garzón).';
      statusEl.className = 'reward-status err';
      return;
    }
    btn.disabled = true;
    statusEl.className = 'reward-status';
    statusEl.textContent = 'Enviando tu premio a la mesa...';
    try {
      var res = await api('/rest/v1/rpc/redeem_reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_client_id: member.clientId,
          p_table_number: mesa,
          p_reward_choice: choiceEl.value,
          // 2do factor: el RPC acepta member_number o los últimos 8 dígitos del teléfono
          p_verify: String(member.memberNumber || member.celular || '')
        })
      });
      var data = res.ok ? await res.json() : null;
      if (!data || !data.ok) {
        statusEl.textContent = REDEEM_REASONS[data && data.reason] || 'No pudimos canjear tu premio. Pídeselo al equipo en tu mesa.';
        statusEl.className = 'reward-status err';
        btn.disabled = false;
        return;
      }
      statusEl.textContent = '¡Listo! Tu ' + choiceEl.value + ' va en camino a la mesa ' + mesa + '.';
      statusEl.className = 'reward-status ok';
      var fresh = await refreshMemberState(member);
      renderRewardBlock(fresh);
      renderVisitTracker(fresh.visitas || 0, fresh);
      setTimeout(close, 2600);
    } catch (e) {
      statusEl.textContent = 'No pudimos conectar. Revisa tu señal e intenta de nuevo.';
      statusEl.className = 'reward-status err';
      btn.disabled = false;
    }
  }


  // ================= MI MESA: ver consumo, pedir y llamar al garzón =================
  // Vive acá y no en el bundle de Expo a propósito: TableServiceScreen lee
  // orders/order_items por REST directo y esas tablas sólo tienen políticas para
  // 'authenticated', así que el sitio público ve cero filas. Reconstruirlo sobre
  // los RPC públicos evita recompilar el bundle (build frágil, ver notas del repo).
  var MESA_KEY = '@almibar_mesa';
  // Categorías que no se piden desde la mesa: cubiertos que comanda el garzón,
  // modificadores y premios del Club (esos van por el flujo de canje).
  var CAT_OCULTAS = ['Tenedor Libre', 'Toppings Sushi', 'Socios', 'Happy Hour', 'Alojamiento'];
  var MESA_REASONS = {
    socio_invalido: 'No pudimos identificarte. Vuelve a ingresar con tu RUT.',
    identidad_invalida: 'No pudimos verificar tu identidad. Pídele al equipo que revise el teléfono de tu ficha.',
    mesa_inexistente: 'Esa mesa no existe. Revisa el número en tu mesa.',
    mesa_sin_cuenta: 'Esa mesa todavía no tiene cuenta abierta. Pídele al garzón que la abra y te registre en ella.',
    mesa_no_es_tuya: 'Esa mesa está registrada a nombre de otra persona. Pídele al garzón que te registre en la tuya: es una vez y queda listo.',
    table_not_found: 'Esa mesa no existe. Revisa el número.',
    sin_items: 'Agrega algo antes de enviar el pedido.',
    no_items: 'Agrega algo antes de enviar el pedido.',
    tipo_invalido: 'No pudimos procesar esa acción.',
    no_items_matched: 'No pudimos encontrar esos productos en la carta. Refresca la página e intenta de nuevo.',
    invalid_table: 'Ese número de mesa no es válido.',
    not_authenticated: 'No pudimos validar tu sesión. Vuelve a ingresar con tu RUT.',
    no_tenant: 'No pudimos validar tu sesión. Vuelve a ingresar con tu RUT.'
  };

  var mesaState = { numero: null, member: null, carta: null, carrito: [], data: null };

  function verifyOf(member) {
    return String((member && (member.memberNumber || member.celular)) || '');
  }
  function readMesa() {
    try { return localStorage.getItem(MESA_KEY) || null; } catch (_) { return null; }
  }
  function saveMesa(n) {
    try { if (n) localStorage.setItem(MESA_KEY, String(n)); else localStorage.removeItem(MESA_KEY); } catch (_) {}
  }

  async function rpc(name, body) {
    var res = await api('/rest/v1/rpc/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('rpc_error');
    return res.json();
  }

  // ---- Botón de entrada en la tarjeta ----
  function renderMesaEntry(member) {
    var card = document.querySelector('[data-member-card]');
    if (!card || !member) return;
    var prev = card.querySelector('[data-mesa-entry]');
    if (prev) prev.remove();
    var box = document.createElement('div');
    box.className = 'mesa-entry';
    box.setAttribute('data-mesa-entry', '');
    box.innerHTML = '<button type="button" class="mesa-entry-btn" data-mesa-open>' +
                    '<span class="mesa-entry-ico" aria-hidden="true">&#127869;</span>' +
                    '<span><strong>Entrar a mi mesa</strong>' +
                    '<em>Revisa lo consumido y pide sin esperar</em></span></button>';
    // va antes de la nota de cierre para que esa nota siga cerrando la tarjeta
    var note = card.querySelector('.member-card-note');
    if (note) card.insertBefore(box, note); else card.appendChild(box);
    box.querySelector('[data-mesa-open]').addEventListener('click', function () { openMesa(member); });
  }

  // ---- Panel principal ----
  function openMesa(member) {
    mesaState.member = member;
    var old = document.querySelector('[data-mesa-panel]');
    if (old) old.remove();

    var wrap = document.createElement('div');
    wrap.className = 'mesa-panel';
    wrap.setAttribute('data-mesa-panel', '');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Mi mesa');
    wrap.innerHTML =
      '<div class="mesa-box">' +
        '<header class="mesa-head">' +
          '<div><div class="mesa-kicker">Almíbar</div>' +
          '<h3 class="mesa-title" data-mesa-title>Mi mesa</h3></div>' +
          '<button type="button" class="mesa-close" data-mesa-close aria-label="Cerrar">&times;</button>' +
        '</header>' +
        '<div class="mesa-body" data-mesa-body></div>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('mesa-abierta');

    function close() {
      wrap.remove();
      document.body.classList.remove('mesa-abierta');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.querySelector('[data-mesa-close]').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    mesaState.close = close;

    var guardada = readMesa();
    if (guardada) { mesaState.numero = guardada; cargarMesa(); }
    else pedirNumero();
  }

  function bodyEl() { return document.querySelector('[data-mesa-body]'); }
  function titleEl() { return document.querySelector('[data-mesa-title]'); }

  function pedirNumero(msg, mesaParaLlamar) {
    titleEl().textContent = 'Mi mesa';
    bodyEl().innerHTML =
      '<p class="mesa-lead">Escribe el número que ves en tu mesa. Para ver tu cuenta y pedir, el garzón debe haberte registrado en ella.</p>' +
      '<label class="mesa-field">Número de mesa' +
        '<input type="number" inputmode="numeric" min="1" step="1" data-mesa-num placeholder="Ej: 12">' +
      '</label>' +
      '<button type="button" class="mesa-cta" data-mesa-go>Entrar</button>' +
      '<p class="mesa-status' + (msg ? ' err' : '') + '" data-mesa-status>' + (msg || '') + '</p>' +
      (mesaParaLlamar ? '<div class="mesa-acciones-sec"><button type="button" class="mesa-btn-sec" data-mesa-llamar>Llamar al garzón</button></div>' : '');
    var input = bodyEl().querySelector('[data-mesa-num]');
    var go = function () {
      var n = parseInt(input.value, 10);
      if (!n || n < 1) { setMesaStatus('Escribe el número de tu mesa.', 'err'); return; }
      mesaState.numero = String(n);
      cargarMesa();
    };
    bodyEl().querySelector('[data-mesa-go]').addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    var llamarBtn = bodyEl().querySelector('[data-mesa-llamar]');
    if (llamarBtn) {
      mesaState.numero = mesaParaLlamar;
      llamarBtn.addEventListener('click', function () { llamar('llamada', this); });
    }
    input.focus();
  }

  function setMesaStatus(txt, cls) {
    var el = document.querySelector('[data-mesa-status]');
    if (!el) return;
    el.textContent = txt || '';
    el.className = 'mesa-status' + (cls ? ' ' + cls : '');
  }

  async function cargarMesa() {
    titleEl().textContent = 'Mesa ' + mesaState.numero;
    bodyEl().innerHTML = '<p class="mesa-lead">Cargando tu cuenta…</p>';
    var m = mesaState.member;
    try {
      var d = await rpc('public_table_state', {
        p_client_id: m.clientId, p_verify: verifyOf(m), p_table_number: parseInt(mesaState.numero, 10)
      });
      if (!d.ok) {
        // Sin vínculo no se puede seguir, pero sí llamar al garzón para que
        // registre al socio: si no, el flujo queda en un callejón sin salida.
        var puedeLlamar = (d.reason === 'mesa_sin_cuenta' || d.reason === 'mesa_no_es_tuya');
        saveMesa(null);
        pedirNumero(MESA_REASONS[d.reason] || 'No pudimos abrir tu mesa.', puedeLlamar ? mesaState.numero : null);
        return;
      }
      mesaState.data = d;
      saveMesa(mesaState.numero);
      pintarCuenta(d);
    } catch (e) {
      bodyEl().innerHTML = '<p class="mesa-status err">No pudimos conectar. Revisa tu señal e intenta de nuevo.</p>';
    }
  }

  function pintarCuenta(d) {
    var acciones =
      '<div class="mesa-acciones">' +
        '<button type="button" class="mesa-cta" data-mesa-pedir>Pedir algo más</button>' +
        '<div class="mesa-acciones-sec">' +
          '<button type="button" class="mesa-btn-sec" data-mesa-llamar>Llamar al garzón</button>' +
          '<button type="button" class="mesa-btn-sec" data-mesa-cuenta>Pedir la cuenta</button>' +
        '</div>' +
      '</div>' +
      '<p class="mesa-status" data-mesa-status></p>' +
      '<button type="button" class="mesa-link" data-mesa-cambiar>No es mi mesa, cambiar número</button>';

    if (!d.has_order) {
      bodyEl().innerHTML =
        '<div class="mesa-vacia"><strong>Tu mesa aún no tiene cuenta abierta</strong>' +
        '<span>Pídele al garzón que la abra y te registre en ella. Puedes llamarlo desde acá.</span></div>' +
        acciones;
      enlazarAcciones();
      return;
    }

    var filas = (d.items || []).map(function (it) {
      var nota = it.notes ? '<span class="mesa-item-nota">' + escapeHtml(it.notes) + '</span>' : '';
      var pend = it.status === 'pendiente' ? '<span class="mesa-chip">en preparación</span>' : '';
      return '<li class="mesa-item">' +
        '<span class="mesa-item-q">' + it.quantity + '×</span>' +
        '<span class="mesa-item-n">' + escapeHtml(it.name) + nota + pend + '</span>' +
        '<span class="mesa-item-p">' + formatCLP(it.total) + '</span></li>';
    }).join('');

    var ahorro = d.saved > 0
      ? '<div class="mesa-ahorro">Llevas ' + formatCLP(d.saved) + ' de descuento en esta mesa</div>' : '';

    bodyEl().innerHTML =
      (filas ? '<ul class="mesa-items">' + filas + '</ul>'
             : '<div class="mesa-vacia"><strong>Todavía no hay nada en tu cuenta</strong>' +
               '<span>Cuando pidas, aparecerá acá al instante.</span></div>') +
      '<div class="mesa-total"><span>Total</span><strong>' + formatCLP(d.total) + '</strong></div>' +
      ahorro + acciones;
    enlazarAcciones(true);
  }

  function enlazarAcciones() {
    var b = bodyEl();
    b.querySelector('[data-mesa-pedir]').addEventListener('click', abrirCarta);
    b.querySelector('[data-mesa-llamar]').addEventListener('click', function () { llamar('llamada', this); });
    b.querySelector('[data-mesa-cuenta]').addEventListener('click', function () { llamar('cuenta', this); });
    b.querySelector('[data-mesa-cambiar]').addEventListener('click', function () { saveMesa(null); pedirNumero(); });
  }

  async function llamar(tipo, btn) {
    var m = mesaState.member;
    btn.disabled = true;
    setMesaStatus(tipo === 'cuenta' ? 'Avisando que quieres la cuenta…' : 'Llamando al garzón…', '');
    try {
      var d = await rpc('public_call_waiter', {
        p_client_id: m.clientId, p_verify: verifyOf(m),
        p_table_number: parseInt(mesaState.numero, 10), p_type: tipo
      });
      if (!d.ok) { setMesaStatus(MESA_REASONS[d.reason] || 'No pudimos avisar. Llama al garzón a la antigua.', 'err'); btn.disabled = false; return; }
      setMesaStatus(d.duplicada
        ? 'Ya avisamos, viene en camino.'
        : (tipo === 'cuenta' ? 'Listo, te llevamos la cuenta.' : 'Listo, el garzón viene en camino.'), 'ok');
      setTimeout(function () { btn.disabled = false; }, 8000);
    } catch (e) {
      setMesaStatus('No pudimos conectar. Revisa tu señal.', 'err');
      btn.disabled = false;
    }
  }

  function escapeHtml(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }


  // ---- Carta para pedir: se arma desde get_public_menu, la misma fuente del POS ----
  async function abrirCarta() {
    titleEl().textContent = 'Pedir · Mesa ' + mesaState.numero;
    bodyEl().innerHTML = '<p class="mesa-lead">Cargando la carta…</p>';
    try {
      if (!mesaState.carta) {
        var d = await rpc('get_public_menu', { p_slug: 'almibar' });
        var cats = {};
        (d.categories || []).forEach(function (c) { cats[c.id] = c; });
        var grupos = {};
        (d.products || []).forEach(function (pr) {
          if (!pr.available) return;
          var c = cats[pr.category_id];
          if (!c || !c.name) return;
          if (CAT_OCULTAS.indexOf(c.name) !== -1) return;
          if (!grupos[c.id]) grupos[c.id] = { name: c.name, sort: c.sort_order == null ? 999 : c.sort_order, items: [] };
          grupos[c.id].items.push(pr);
        });
        mesaState.carta = Object.keys(grupos).map(function (k) { return grupos[k]; })
          .filter(function (g) { return g.items.length; })
          .sort(function (a, b) { return a.sort - b.sort || a.name.localeCompare(b.name, 'es'); });
        mesaState.carta.forEach(function (g) {
          g.items.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'es'); });
        });
      }
      pintarCarta();
    } catch (e) {
      bodyEl().innerHTML = '<p class="mesa-status err">No pudimos cargar la carta. Intenta de nuevo.</p>' +
                           '<button type="button" class="mesa-link" data-mesa-volver>Volver a mi cuenta</button>';
      bodyEl().querySelector('[data-mesa-volver]').addEventListener('click', cargarMesa);
    }
  }

  function pintarCarta() {
    var nav = mesaState.carta.map(function (g, i) {
      return '<button type="button" class="mesa-tab' + (i === 0 ? ' is-on' : '') + '" data-mesa-tab="' + i + '">' +
             escapeHtml(g.name) + '</button>';
    }).join('');

    var listas = mesaState.carta.map(function (g, i) {
      var items = g.items.map(function (pr) {
        var desc = pr.description ? '<span class="mesa-prod-desc">' + escapeHtml(pr.description) + '</span>' : '';
        return '<li class="mesa-prod">' +
          '<span class="mesa-prod-n">' + escapeHtml(pr.name) + desc + '</span>' +
          '<span class="mesa-prod-p">' + formatCLP(pr.price) + '</span>' +
          '<button type="button" class="mesa-add" data-add="' + pr.id + '" aria-label="Agregar ' + escapeHtml(pr.name) + '">+</button>' +
          '</li>';
      }).join('');
      return '<ul class="mesa-prods' + (i === 0 ? ' is-on' : '') + '" data-mesa-list="' + i + '">' + items + '</ul>';
    }).join('');

    bodyEl().innerHTML =
      '<button type="button" class="mesa-link" data-mesa-volver>&larr; Volver a mi cuenta</button>' +
      '<div class="mesa-tabs" role="tablist">' + nav + '</div>' +
      '<div class="mesa-listas">' + listas + '</div>' +
      '<div class="mesa-carrito" data-mesa-carrito hidden></div>';

    bodyEl().querySelector('[data-mesa-volver]').addEventListener('click', cargarMesa);
    Array.prototype.forEach.call(bodyEl().querySelectorAll('[data-mesa-tab]'), function (b) {
      b.addEventListener('click', function () {
        var i = b.getAttribute('data-mesa-tab');
        Array.prototype.forEach.call(bodyEl().querySelectorAll('[data-mesa-tab]'), function (x) { x.classList.remove('is-on'); });
        Array.prototype.forEach.call(bodyEl().querySelectorAll('[data-mesa-list]'), function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        bodyEl().querySelector('[data-mesa-list="' + i + '"]').classList.add('is-on');
        bodyEl().querySelector('.mesa-listas').scrollTop = 0;
      });
    });
    Array.prototype.forEach.call(bodyEl().querySelectorAll('[data-add]'), function (b) {
      b.addEventListener('click', function () { agregar(b.getAttribute('data-add'), b); });
    });
    pintarCarrito();
  }

  function buscarProducto(id) {
    for (var i = 0; i < mesaState.carta.length; i++) {
      var it = mesaState.carta[i].items;
      for (var j = 0; j < it.length; j++) if (it[j].id === id) return it[j];
    }
    return null;
  }

  function agregar(id, btn) {
    var pr = buscarProducto(id);
    if (!pr) return;
    var linea = null;
    for (var i = 0; i < mesaState.carrito.length; i++) if (mesaState.carrito[i].id === id) linea = mesaState.carrito[i];
    if (linea) linea.qty += 1;
    else mesaState.carrito.push({ id: id, name: pr.name, price: pr.price, qty: 1 });
    if (btn) { btn.classList.add('is-hit'); setTimeout(function () { btn.classList.remove('is-hit'); }, 320); }
    pintarCarrito();
  }

  function quitar(id) {
    for (var i = 0; i < mesaState.carrito.length; i++) {
      if (mesaState.carrito[i].id === id) {
        mesaState.carrito[i].qty -= 1;
        if (mesaState.carrito[i].qty <= 0) mesaState.carrito.splice(i, 1);
        break;
      }
    }
    pintarCarrito();
  }

  function pintarCarrito() {
    var el = bodyEl() && bodyEl().querySelector('[data-mesa-carrito]');
    if (!el) return;
    if (!mesaState.carrito.length) { el.hidden = true; el.innerHTML = ''; return; }
    var total = 0, n = 0;
    var filas = mesaState.carrito.map(function (l) {
      total += l.price * l.qty; n += l.qty;
      return '<li class="mesa-cl">' +
        '<button type="button" class="mesa-menos" data-menos="' + l.id + '" aria-label="Quitar uno">&minus;</button>' +
        '<span class="mesa-cl-q">' + l.qty + '×</span>' +
        '<span class="mesa-cl-n">' + escapeHtml(l.name) + '</span>' +
        '<span class="mesa-cl-p">' + formatCLP(l.price * l.qty) + '</span></li>';
    }).join('');
    el.hidden = false;
    el.innerHTML =
      '<div class="mesa-cl-head">Tu pedido <span>' + n + (n === 1 ? ' ítem' : ' ítems') + '</span></div>' +
      '<ul class="mesa-cls">' + filas + '</ul>' +
      '<div class="mesa-cl-total"><span>Total a agregar</span><strong>' + formatCLP(total) + '</strong></div>' +
      '<p class="mesa-cl-nota">El precio final puede bajar si tienes descuentos vigentes.</p>' +
      '<button type="button" class="mesa-cta" data-mesa-enviar>Enviar a la cocina</button>' +
      '<p class="mesa-status" data-mesa-status></p>';
    Array.prototype.forEach.call(el.querySelectorAll('[data-menos]'), function (b) {
      b.addEventListener('click', function () { quitar(b.getAttribute('data-menos')); });
    });
    el.querySelector('[data-mesa-enviar]').addEventListener('click', enviarPedido);
  }

  async function enviarPedido() {
    var m = mesaState.member;
    var btn = bodyEl().querySelector('[data-mesa-enviar]');
    if (!mesaState.carrito.length) return;
    btn.disabled = true;
    setMesaStatus('Enviando tu pedido…', '');
    // Id de petición: si el toque se repite o se corta la señal, no se duplica
    // el pedido — app_send_order es idempotente por este valor.
    if (!mesaState.reqId) mesaState.reqId = uuidv4();
    try {
      var d = await rpc('public_send_order', {
        p_client_id: m.clientId,
        p_verify: verifyOf(m),
        p_table_number: parseInt(mesaState.numero, 10),
        p_items: mesaState.carrito.map(function (l) { return { product_id: l.id, quantity: l.qty }; }),
        p_notes: null,
        p_client_request_id: mesaState.reqId
      });
      if (!d.ok) {
        setMesaStatus(MESA_REASONS[d.reason] || 'No pudimos enviar el pedido. Llama al garzón.', 'err');
        btn.disabled = false; mesaState.reqId = null;
        return;
      }
      var saltados = (d.skipped || []).length;
      setMesaStatus(saltados
        ? 'Pedido enviado, pero ' + saltados + ' producto(s) no estaban disponibles.'
        : '¡Pedido enviado! Ya va a la cocina.', 'ok');
      mesaState.carrito = []; mesaState.reqId = null;
      setTimeout(cargarMesa, 1600);
    } catch (e) {
      setMesaStatus('No pudimos conectar. Revisa tu señal e intenta de nuevo.', 'err');
      btn.disabled = false;
    }
  }

  function uuidv4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function renderCard(member) {
    var card = document.querySelector('[data-member-card]');
    if (!card || !member) return;
    card.querySelector('[data-member-name]').textContent = member.nombre || 'Socio Almíbar';
    card.querySelector('[data-member-id]').textContent = member.memberId || 'Socio registrado';
    card.querySelector('[data-member-visits]').textContent = String(member.visitas || 0) + ' visitas';
    card.querySelector('[data-member-tier]').textContent = member.isVip ? 'Socio VIP' : 'Socio activo';
    card.classList.add('is-visible');
    renderVisitTracker(member.visitas || 0, member);
    setupMarkVisit(member);
    renderRewardBlock(member);
    renderSavings(member);
    renderMesaEntry(member);
    // Pintamos primero con lo guardado (instantáneo) y luego repintamos con el
    // estado real del servidor: si ganó un premio en otra visita, aparece acá.
    refreshMemberState(member).then(function (fresh) {
      if (!fresh || fresh === member) return;
      var v = card.querySelector('[data-member-visits]');
      var t = card.querySelector('[data-member-tier]');
      if (v) v.textContent = String(fresh.visitas || 0) + ' visitas';
      if (t) t.textContent = fresh.isVip ? 'Socio VIP' : 'Socio activo';
      renderVisitTracker(fresh.visitas || 0, fresh);
      renderRewardBlock(fresh);
      renderSavings(fresh);
      renderMesaEntry(fresh);
      setupMarkVisit(fresh);
    });
  }

  // Marcador de visitas: llena los sellos según el avance hacia el premio (cada 3 visitas).
  function renderVisitTracker(visitas, member) {
    var tracker = document.querySelector('[data-visit-tracker]');
    if (!tracker) return;
    // Fuente de verdad: visits_for_reward + client_rewards (vía el RPC), NUNCA
    // "visitas % 3": el ciclo se resetea al ganar premio y ambos se desfasan.
    var hasCycle = member && typeof member.visitsForReward === 'number';
    var prog = hasCycle ? member.visitsForReward : (visitas % 3);
    var earned = hasCycle ? !!member.rewardAvailable : (visitas > 0 && prog === 0);
    var stamps = tracker.querySelectorAll('[data-stamp]');
    for (var i = 0; i < stamps.length; i++) {
      stamps[i].classList.toggle('filled', earned || i < prog);
    }
    var left = 3 - prog;
    var title = tracker.querySelector('[data-visit-title]');
    var sub = tracker.querySelector('[data-visit-sub]');
    if (title) title.textContent = earned ? '¡Tienes un premio disponible!' : ('Te ' + (left === 1 ? 'falta 1 visita' : ('faltan ' + left + ' visitas')) + ' para tu premio');
    if (sub) sub.textContent = 'Llevas ' + visitas + (visitas === 1 ? ' visita' : ' visitas') + ' acumuladas.';
  }

  // --- Marcar visita "Estoy en Almíbar" (mismo flujo que la app antigua) ---
  // Pide GPS del dispositivo (obligatorio: hay que estar físicamente en el local).
  function getCoords() {
    return new Promise(function (resolve, reject) {
      if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('no_geo')); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        function (err) { reject(err); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  var VISIT_REASONS = {
    sin_servicio: 'El local no está en servicio ahora. Vuelve en horario de atención.',
    sin_gps: 'Necesitamos tu ubicación para marcar la visita. Activa el GPS y permite el acceso.',
    fuera_de_zona: 'Parece que no estás en Almíbar. Marca tu visita cuando estés en el local. 📍',
    socio_invalido: 'No pudimos identificarte como socio. Vuelve a ingresar con tu RUT.'
  };

  function setVisitStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  // Actualiza los sellos y el título del marcador desde la respuesta del servidor.
  function applyVisitProgress(vfr, rewardAvailable) {
    var tracker = document.querySelector('[data-visit-tracker]');
    if (!tracker) return;
    var stamps = tracker.querySelectorAll('[data-stamp]');
    for (var i = 0; i < stamps.length; i++) {
      stamps[i].classList.toggle('filled', rewardAvailable || i < vfr);
    }
    var title = tracker.querySelector('[data-visit-title]');
    if (title) {
      var faltan = Math.max(3 - vfr, 0);
      title.textContent = rewardAvailable
        ? '¡Tienes un premio disponible!'
        : ('Te ' + (faltan === 1 ? 'falta 1 visita' : ('faltan ' + faltan + ' visitas')) + ' para tu premio');
    }
  }

  async function markVisit(member, btn) {
    var statusEl = document.querySelector('[data-visit-status]');
    if (!member || !member.clientId) return;
    btn.disabled = true;
    setVisitStatus(statusEl, 'Obteniendo tu ubicación…', '');
    var coords;
    try {
      coords = await getCoords();
    } catch (e) {
      setVisitStatus(statusEl, 'Activa el GPS y permite la ubicación: necesitamos confirmar que estás en Almíbar. 📍', 'err');
      btn.disabled = false;
      return;
    }
    try {
      var res = await api('/rest/v1/rpc/register_visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_client_id: member.clientId, p_lat: coords.lat, p_lng: coords.lng })
      });
      var data = res.ok ? await res.json() : null;
      if (!data || !data.ok) {
        setVisitStatus(statusEl, VISIT_REASONS[data && data.reason] || 'No pudimos marcar tu visita. Intenta de nuevo en un momento.', 'err');
        btn.disabled = false;
        return;
      }
      applyVisitProgress(data.visits_for_reward || 0, !!data.reward_available);
      // Si acaba de ganar, el botón de elegir premio debe aparecer al tiro:
      // el aviso pasivo era justamente donde se perdían los canjes.
      member.visitsForReward = data.visits_for_reward || 0;
      member.rewardAvailable = !!data.reward_available;
      if (data.reward_available) member.rewardsAvailable = Math.max(member.rewardsAvailable || 0, 1);
      renderRewardBlock(member);
      if (data.just_earned) {
        setVisitStatus(statusEl, '🎉 ¡Completaste 3 visitas! Tienes un premio para canjear en tu mesa.', 'ok');
      } else if (data.reward_available) {
        setVisitStatus(statusEl, 'Visita registrada ✅ Tienes un premio listo para canjear.', 'ok');
      } else {
        setVisitStatus(statusEl, 'Visita registrada ✅ Llevas ' + (data.visits_for_reward || 0) + '/3 · te falta' + (data.faltan === 1 ? '' : 'n') + ' ' + data.faltan + '.', 'ok');
      }
      btn.disabled = false;
    } catch (e) {
      setVisitStatus(statusEl, 'No pudimos registrar tu visita. Revisa tu conexión.', 'err');
      btn.disabled = false;
    }
  }

  // Muestra el botón "Estoy en Almíbar" y lo cablea (solo para socios reconocidos).
  function setupMarkVisit(member) {
    var wrap = document.querySelector('[data-visit-actions]');
    var btn = wrap && wrap.querySelector('[data-mark-visit]');
    if (!wrap || !btn || !member || !member.clientId) return;
    wrap.hidden = false;
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', function () { markVisit(member, btn); });
  }

  function closeGate() {
    var gate = document.querySelector('[data-entry-gate]');
    if (gate) gate.hidden = true;
    document.body.classList.remove('entry-locked');
  }

  function status(message, isError) {
    var el = document.querySelector('[data-entry-status]');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
  }

  async function findMember(phone) {
    var rut = arguments[1] || '';
    var cleanRut = rut.trim();
    if (cleanRut.replace(/[^0-9kK]/g, '').length < 8) throw new Error('Ingresa tu RUT completo para reconocer tu membresía.');
    var response = await api('/rest/v1/rpc/find_member_by_rut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_rut: cleanRut, p_restaurant_id: RESTAURANT_ID })
    });
    if (!response.ok) throw new Error('No pudimos consultar el registro.');
    var result = await response.json();
    if (result && result.found && result.member) {
      var data = result.member;
      return {
        clientId: data.clientId,
        nombre: data.name || 'Socio Almíbar',
        celular: data.phone || phone,
        rut: data.rut || cleanRut,
        email: data.email || '',
        fechaNac: data.birthday || '',
        memberId: data.memberId || '',
        memberNumber: data.memberNumber || null,
        visitas: data.total_visits || 0,
        premios: data.rewards_claimed || 0,
        tier: data.tier || 'normal',
        vipExpiresAt: data.vip_expires_at || null,
        isVip: data.tier === 'vip',
        // Estado REAL del ciclo y del premio. El RPC ya los entrega y antes se
        // descartaban: la tarjeta calculaba "visitas % 3", que se desfasa del
        // backend porque visits_for_reward se resetea al ganar el premio.
        visitsForReward: data.visits_for_reward || 0,
        rewardsAvailable: data.rewards_available || 0,
        rewardAvailable: !!data.reward_available,
        totalSaved: data.total_saved || 0
      };
    }
    return null;
  }

  function guestAccess() {
    localStorage.removeItem(MEMBER_KEY);
    saveConsent('guest', null);
    closeGate();
    status('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var gate = document.querySelector('[data-entry-gate]');
    if (!gate) return;
    var member = readMember();
    var priorConsent = consentAccepted();
    if (priorConsent && priorConsent.mode === 'member' && member) { renderCard(member); closeGate(); return; }
    // Invitado que ya entró antes: va directo a la carta, sin volver a mostrar el muro.
    // El sitio es principalmente carta + reservas, así que no se re-bloquea en cada visita.
    if (priorConsent && priorConsent.mode === 'guest') { closeGate(); return; }

    var form = gate.querySelector('[data-entry-form]');
    var rutInput = gate.querySelector('[name="entry-rut"]');
    var consent = gate.querySelector('[name="entry-consent"]');
    var lookup = gate.querySelector('[data-entry-lookup]');
    var guest = gate.querySelector('[data-entry-guest]');
    var busy = false;

    guest.addEventListener('click', guestAccess);

    // Un solo paso: RUT + condiciones → Ingresar. Si el RUT es socio, entra
    // directo con sus beneficios; si no, se queda en el muro para reintentar
    // o entrar como invitado.
    async function ingresar() {
      if (busy) return;
      if (!consent.checked) { status('Para entrar con tus beneficios acepta las condiciones. También puedes entrar como invitado.', true); return; }
      var rut = rutInput.value.trim();
      if (!rut) { status('Ingresa tu RUT para reconocer tu membresía.', true); rutInput.focus(); return; }
      busy = true; lookup.disabled = true;
      status('Buscando tu registro...');
      try {
        var found = await findMember('', rut);
        if (found) {
          saveConsent('member', found);
          renderCard(found);
          closeGate();
          return;
        }
        status('No encontramos ese RUT como socio. Revisa el número, o entra como invitado.', true);
      } catch (error) {
        status(error.message || 'No pudimos buscar tu registro.', true);
      } finally {
        busy = false; lookup.disabled = false;
      }
    }

    lookup.addEventListener('click', function (event) { event.preventDefault(); ingresar(); });
    form.addEventListener('submit', function (event) { event.preventDefault(); ingresar(); });
  });
})();
