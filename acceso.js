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

  function renderCard(member) {
    var card = document.querySelector('[data-member-card]');
    if (!card || !member) return;
    card.querySelector('[data-member-name]').textContent = member.nombre || 'Socio Almíbar';
    card.querySelector('[data-member-id]').textContent = member.memberId || 'Socio registrado';
    card.querySelector('[data-member-visits]').textContent = String(member.visitas || 0) + ' visitas';
    card.querySelector('[data-member-tier]').textContent = member.isVip ? 'Socio VIP' : 'Socio activo';
    card.classList.add('is-visible');
    renderVisitTracker(member.visitas || 0);
    setupMarkVisit(member);
  }

  // Marcador de visitas: llena los sellos según el avance hacia el premio (cada 3 visitas).
  function renderVisitTracker(visitas) {
    var tracker = document.querySelector('[data-visit-tracker]');
    if (!tracker) return;
    var prog = visitas % 3;
    var earned = visitas > 0 && prog === 0;
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
        visitas: data.total_visits || 0,
        premios: data.rewards_claimed || 0,
        tier: data.tier || 'normal',
        vipExpiresAt: data.vip_expires_at || null,
        isVip: data.tier === 'vip'
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
