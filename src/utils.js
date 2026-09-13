// ============================================
// Utilidades de cálculo de préstamos y WhatsApp
// ============================================

// Formatea un número como moneda (por defecto sin símbolo fijo para que sirva en cualquier país)
function formatoDinero(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Devuelve el número de días entre dos fechas (YYYY-MM-DD).
function diasEntre(fechaInicio, fechaFin) {
  const ini = new Date(fechaInicio + 'T00:00:00');
  const fin = new Date(fechaFin + 'T00:00:00');
  const msPorDia = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.round((fin - ini) / msPorDia));
}

// Calcula los totales de un préstamo.
//
// 1) INTERÉS NORMAL (dentro del plazo):
//    Se cobra el porcentaje mensual COMPLETO (1 mes) del monto.
//    interesNormal = monto * (% mensual / 100)
//
// 2) INTERÉS DE MORA (después de la fecha de caducidad):
//    Se cobra un porcentaje POR CADA DÍA de atraso (editable por préstamo).
//    mora = monto * (% mora diaria / 100) * díasAtraso
//    Los días de atraso se cuentan desde la fecha de caducidad hasta HOY.
//
// total = monto + interesNormal + mora
function calcularPrestamo(prestamo, hoyStr) {
  const monto = Number(prestamo.monto) || 0;
  const interesMensual = Number(prestamo.interes_mensual) || 0;
  const moraDiaria = prestamo.mora_diaria != null ? Number(prestamo.mora_diaria) : 0;

  // Días del préstamo (entre inicio y caducidad) — informativo
  let dias = Number(prestamo.dias) || 0;
  if (!dias && prestamo.fecha_inicio && prestamo.fecha_caducidad) {
    dias = diasEntre(prestamo.fecha_inicio, prestamo.fecha_caducidad);
  }

  // Interés normal: 1 mes completo
  const interesNormal = monto * (interesMensual / 100);

  // Días de atraso (desde la caducidad hasta hoy)
  const hoy = hoyStr || new Date().toISOString().slice(0, 10);
  let diasAtraso = 0;
  if (prestamo.fecha_caducidad) {
    diasAtraso = diasEntre(prestamo.fecha_caducidad, hoy); // 0 si aún no vence
  }

  // Mora por días de atraso
  const mora = monto * (moraDiaria / 100) * diasAtraso;

  const interesTotal = interesNormal + mora;
  const total = monto + interesTotal;

  return {
    monto,
    interesMensual,
    moraDiaria,
    dias,
    diasAtraso,
    interesNormal,      // interés del mes (dentro del plazo)
    interesPorMes: interesNormal,
    mora,               // interés de mora acumulado
    interesTotal,       // interesNormal + mora
    totalAPagar: total,
  };
}

// Devuelve el estado de vencimiento respecto a hoy.
// Retorna: { diasRestantes, vencido, porVencer, textoEstado, clase }
function estadoVencimiento(fechaCaducidad, diasAviso = 3) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const caducidad = new Date(fechaCaducidad + 'T00:00:00');
  const msPorDia = 1000 * 60 * 60 * 24;
  const diasRestantes = Math.round((caducidad - hoy) / msPorDia);

  const vencido = diasRestantes < 0;
  const porVencer = diasRestantes >= 0 && diasRestantes <= diasAviso;

  let textoEstado;
  let clase;
  if (vencido) {
    textoEstado = `Vencido hace ${Math.abs(diasRestantes)} día(s)`;
    clase = 'vencido';
  } else if (diasRestantes === 0) {
    textoEstado = 'Vence hoy';
    clase = 'por-vencer';
  } else if (porVencer) {
    textoEstado = `Vence en ${diasRestantes} día(s)`;
    clase = 'por-vencer';
  } else {
    textoEstado = `Vence en ${diasRestantes} día(s)`;
    clase = 'al-dia';
  }

  return { diasRestantes, vencido, porVencer, textoEstado, clase };
}

// Suma meses a una fecha (YYYY-MM-DD) y devuelve YYYY-MM-DD
function sumarMeses(fechaInicio, meses) {
  const d = new Date(fechaInicio + 'T00:00:00');
  d.setMonth(d.getMonth() + Number(meses));
  return d.toISOString().slice(0, 10);
}

// Suma días a una fecha (YYYY-MM-DD) y devuelve YYYY-MM-DD
function sumarDias(fechaInicio, dias) {
  const d = new Date(fechaInicio + 'T00:00:00');
  d.setDate(d.getDate() + Number(dias));
  return d.toISOString().slice(0, 10);
}

// Normaliza un teléfono al formato internacional para wa.me.
// - Deja solo dígitos.
// - Si empieza con 00 (prefijo internacional), lo quita.
// - Si empieza con 0 (formato local), quita el 0 y antepone el código de país.
// - Si no trae el código de país, lo antepone.
function limpiarTelefono(telefono) {
  const codigoPais = String(process.env.CODIGO_PAIS || '').replace(/\D/g, '');
  let n = String(telefono || '').replace(/\D/g, '');
  if (!n) return '';

  // Prefijo internacional 00 -> quitarlo (ya viene con código de país)
  if (n.startsWith('00')) {
    return n.slice(2);
  }

  if (codigoPais) {
    // Formato local con 0 inicial: 0988... -> 593988...
    if (n.startsWith('0')) {
      return codigoPais + n.slice(1);
    }
    // Ya trae el código de país
    if (n.startsWith(codigoPais)) {
      return n;
    }
    // No trae código de país: anteponerlo
    return codigoPais + n;
  }

  return n;
}

// Genera el enlace de WhatsApp (wa.me) con un mensaje pre-armado.
function linkWhatsApp(telefono, mensaje) {
  const tel = limpiarTelefono(telefono);
  const texto = encodeURIComponent(mensaje);
  return `https://wa.me/${tel}?text=${texto}`;
}

// Determina la SITUACIÓN del préstamo según la fecha:
//   'con_tiempo'  -> aún falta bastante para vencer
//   'por_vencer'  -> faltan pocos días (según diasAviso)
//   'dia_pago'    -> vence hoy
//   'vencido'     -> ya pasó la fecha de caducidad
function situacionPrestamo(estado) {
  if (estado.vencido) return 'vencido';
  if (estado.diasRestantes === 0) return 'dia_pago';
  if (estado.porVencer) return 'por_vencer';
  return 'con_tiempo';
}

// Etiqueta legible para la situación (para mostrar en botones)
function etiquetaSituacion(situacion) {
  switch (situacion) {
    case 'vencido': return 'Vencido';
    case 'dia_pago': return 'Día de pago';
    case 'por_vencer': return 'Por vencer';
    default: return 'Recordatorio';
  }
}

// Arma el mensaje de WhatsApp según la situación del préstamo.
function mensajeRecordatorio(cliente, prestamo, calculo, estado) {
  const nombre = (cliente.nombres || cliente.nombre || 'Cliente').split(' ')[0];
  const negocio = process.env.NOMBRE_NEGOCIO || 'El Coyote Malo';
  const situacion = situacionPrestamo(estado);
  const monto = formatoDinero(calculo.monto);
  const total = formatoDinero(calculo.totalAPagar);
  const fecha = prestamo.fecha_caducidad;

  let cuerpo;
  switch (situacion) {
    case 'vencido': {
      const detalleMora = calculo.mora > 0
        ? ` Se ha sumado una mora de ${formatoDinero(calculo.mora)} por ${calculo.diasAtraso} día(s) de atraso.`
        : '';
      cuerpo = `${negocio} le avisa que su préstamo de ${monto} está VENCIDO (venció el ${fecha}).${detalleMora} El total a pagar hoy es ${total}. Por favor comuníquese para regularizar. Gracias.`;
      break;
    }
    case 'dia_pago':
      cuerpo = `${negocio} le recuerda que hoy ${fecha} es la fecha de pago de su préstamo de ${monto}. El total a pagar es ${total}. Quedo atento a su pago. Gracias.`;
      break;
    case 'por_vencer':
      cuerpo = `${negocio} le recuerda que su préstamo de ${monto} vence en ${estado.diasRestantes} día(s) (el ${fecha}). El total a pagar es ${total}. Le aviso para que lo tenga presente. Gracias.`;
      break;
    default:
      cuerpo = `${negocio} le saluda y le recuerda que tiene un préstamo de ${monto} que vence el ${fecha}. El total a pagar es ${total}. Cualquier consulta me avisa. Gracias.`;
  }

  return `Hola ${nombre}, ${cuerpo}`;
}

module.exports = {
  formatoDinero,
  calcularPrestamo,
  estadoVencimiento,
  situacionPrestamo,
  etiquetaSituacion,
  diasEntre,
  sumarMeses,
  sumarDias,
  limpiarTelefono,
  linkWhatsApp,
  mensajeRecordatorio,
};
