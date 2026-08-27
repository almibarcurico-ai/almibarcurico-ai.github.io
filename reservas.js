(function () {
  const SUPABASE_URL = 'https://gxjzwyickfrqxnhaajwv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1PB5Th-ci7WU22PhPRFimg_usyfrysE';
  const SLUG = 'almibar';

  const errorMessages = {
    feature_not_in_plan: 'Este local no tiene reservas habilitadas.',
    invalid_personas: 'Las reservas son de 2 a 50 personas.',
    invalid_fecha: 'Elige una fecha válida desde hoy en adelante.',
    nombre_required: 'Escribe tu nombre.',
    celular_required: 'Escribe un WhatsApp de contacto.',
    too_many_attempts: 'Hay demasiados intentos seguidos. Espera unos minutos.',
    cupo_tenedor_libre: 'No hay cupos para esa fecha.',
    tenant_not_found: 'No encontramos el local de Almíbar.',
    server_error: 'No pudimos conectar con reservas. Intenta de nuevo.',
  };

  const weekdayName = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const baseSlots = [
    '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00',
    '20:30', '21:00', '21:30', '22:00', '22:30', '23:00', '23:30',
  ];

  const slotsByDay = {
    1: baseSlots,
    2: baseSlots,
    3: baseSlots.concat(['00:00', '00:30']),
    4: baseSlots.concat(['00:00', '00:30', '01:00', '01:30']),
    5: baseSlots.concat(['00:00', '00:30', '01:00', '01:30', '02:00', '02:30']),
    6: baseSlots.concat(['00:00', '00:30', '01:00', '01:30', '02:00', '02:30']),
  };

  const closeByDay = {
    1: '00:00',
    2: '00:00',
    3: '01:00',
    4: '02:00',
    5: '03:00',
    6: '03:00',
  };

  const motivoByParam = {
    cumple: 'Cumpleaños',
    cumpleanos: 'Cumpleaños',
    celebracion: 'Celebración',
    reunion: 'Reunión',
    empresa: 'Empresa',
    otro: 'Otro',
  };

  const form = document.getElementById('reservation-form');
  const success = document.getElementById('reservation-success');
  const successCopy = document.getElementById('success-copy');
  const status = document.getElementById('reservation-status');
  const submit = document.getElementById('reserve-submit');
  const fecha = document.getElementById('fecha');
  const hora = document.getElementById('hora');
  const hourHelp = document.getElementById('hour-help');
  const slotGrid = document.getElementById('slot-grid');
  const motivoInput = document.getElementById('motivo');
  const successBenefits = document.getElementById('success-benefits');

  if (!form || !success || !fecha || !hora || !slotGrid || !motivoInput) return;

  function localISODate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function parseLocalDate(value) {
    if (!value) return null;
    const parts = value.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }

  function nextOpenDate() {
    const d = new Date();
    while (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return localISODate(d);
  }

  function setStatus(message, ok) {
    status.textContent = message || '';
    status.classList.toggle('ok', Boolean(ok));
  }

  function setMotivo(value) {
    motivoInput.value = value;
    document.querySelectorAll('[data-motivo]').forEach((button) => {
      button.classList.toggle('active', button.dataset.motivo === value);
    });
  }

  function renderSlots() {
    const selected = parseLocalDate(fecha.value);
    const day = selected ? selected.getDay() : -1;
    const slots = slotsByDay[day] || [];
    hora.value = '';
    slotGrid.textContent = '';

    if (!slots.length) {
      hourHelp.textContent = 'Almíbar atiende de lunes a sábado. Elige otra fecha para reservar.';
      return;
    }

    hourHelp.textContent = `${weekdayName[day]}: reservas desde las 17:00 hasta 30 minutos antes del cierre (${closeByDay[day]}).`;
    slots.forEach((slot) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot-option';
      button.textContent = slot;
      button.dataset.slot = slot;
      button.addEventListener('click', () => {
        hora.value = slot;
        slotGrid.querySelectorAll('.slot-option').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        setStatus('', false);
      });
      slotGrid.appendChild(button);
    });
  }

  function validate(payload) {
    if (!payload.p_motivo) return 'Elige el motivo de tu reserva.';
    if (!payload.p_fecha) return 'Elige el día de la reserva.';
    const selected = parseLocalDate(payload.p_fecha);
    if (!selected || selected.getDay() === 0) return 'Almíbar recibe reservas de lunes a sábado.';
    if (!payload.p_hora) return 'Elige una hora.';
    if (!payload.p_nombre || payload.p_nombre.length < 2) return 'Escribe tu nombre.';
    if (String(payload.p_celular || '').replace(/\D/g, '').length < 8) return 'Escribe un WhatsApp válido.';
    if (!Number.isFinite(payload.p_personas) || payload.p_personas < 2 || payload.p_personas > 50) {
      return 'Indica entre 2 y 50 personas.';
    }
    return '';
  }

  function benefitsForReservation(payload) {
    const people = Number(payload.p_personas) || 0;
    const selected = parseLocalDate(payload.p_fecha);
    const normalizedMotivo = String(payload.p_motivo || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const isBirthday = normalizedMotivo === 'cumpleanos';

    if (people < 2) return [];

    if (selected && selected.getDay() === 3) {
      return ['40% de descuento en el total de la cuenta (no aplica sobre productos en promoción ni Happy Hour).'];
    }

    const benefits = [];

    if (people >= 16) {
      benefits.push('50% de descuento en barra: cócteles, piscos, sours, spritz y schop.');
    } else if (isBirthday) {
      if (people >= 2 && people <= 5) benefits.push('1 cóctel gratis para el festejado/a.');
      if (people >= 6 && people <= 15) benefits.push('2 cócteles gratis para el festejado/a.');
    }

    if (people >= 10) {
      benefits.push('Ronda de tequila gratis para todos.');
    }

    return benefits;
  }

  function benefitNotes(benefits) {
    if (!benefits.length) return 'Beneficios asignados: sin beneficio automático asignado por día, motivo o cantidad de personas.';
    return `Beneficios asignados:\n${benefits.map((benefit) => `- ${benefit}`).join('\n')}`;
  }

  function renderBenefits(benefits) {
    if (!successBenefits) return;
    successBenefits.textContent = '';

    const label = document.createElement('span');
    label.textContent = 'Beneficios asignados';
    successBenefits.appendChild(label);

    const list = document.createElement('ul');
    const lines = benefits.length
      ? benefits
      : ['Sin beneficio automático asignado por día, motivo o cantidad de personas.'];
    lines.forEach((benefit) => {
      const item = document.createElement('li');
      item.textContent = benefit;
      list.appendChild(item);
    });
    successBenefits.appendChild(list);
  }

  async function submitReservation(payload) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_public_reservation`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.error)) {
      const key = data && data.error ? data.error : 'server_error';
      throw new Error(errorMessages[key] || `No se pudo enviar la reserva: ${key}`);
    }
    return data || {};
  }

  document.querySelectorAll('[data-motivo]').forEach((button) => {
    button.addEventListener('click', () => {
      setMotivo(button.dataset.motivo || 'Celebración');
      setStatus('', false);
    });
  });

  fecha.min = localISODate(new Date());
  fecha.value = nextOpenDate();
  fecha.addEventListener('change', renderSlots);

  const paramMotivo = new URLSearchParams(window.location.search).get('motivo');
  if (paramMotivo) {
    const clean = paramMotivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (motivoByParam[clean]) setMotivo(motivoByParam[clean]);
  }

  renderSlots();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawNotes = document.getElementById('notas').value.trim();
    const payload = {
      p_slug: SLUG,
      p_nombre: document.getElementById('nombre').value.trim(),
      p_celular: document.getElementById('celular').value.trim(),
      p_motivo: motivoInput.value,
      p_personas: Number(document.getElementById('personas').value),
      p_fecha: fecha.value,
      p_hora: hora.value,
      p_notas: rawNotes || null,
    };

    const problem = validate(payload);
    if (problem) {
      setStatus(problem, false);
      return;
    }

    const benefits = benefitsForReservation(payload);
    payload.p_notas = [rawNotes, benefitNotes(benefits)].filter(Boolean).join('\n\n') || null;

    submit.disabled = true;
    submit.textContent = 'Enviando reserva...';
    setStatus('Enviando al POS de Almíbar...', true);

    try {
      const result = await submitReservation(payload);
      const selected = parseLocalDate(payload.p_fecha);
      const readableDate = selected
        ? selected.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
        : payload.p_fecha;
      form.hidden = true;
      success.classList.add('show');
      successCopy.textContent = `Reserva para ${payload.p_personas} personas, ${readableDate} a las ${payload.p_hora}. Código: ${result.id || 'recibido'}.`;
      renderBenefits(benefits);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setStatus(error.message || 'No se pudo enviar la reserva. Intenta de nuevo.', false);
      submit.disabled = false;
      submit.textContent = 'Enviar reserva al POS';
    }
  });
})();
