// ============================================
// Validaciones para el registro público de clientes
// Se usan en el SERVIDOR (seguridad real, no se puede saltar).
// ============================================

// Solo letras (incluye acentos y ñ) y espacios. Sin números ni símbolos.
const RE_LETRAS = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü ]+$/;

// Correo con formato básico válido.
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Caracteres peligrosos que NO se permiten en la dirección.
// Bloquea: < > { } [ ] | \ ` ^ ~ (evita inyección y basura).
const RE_DIRECCION_PELIGROSA = /[<>{}\[\]|\\`^~]/;

// Limpia espacios sobrantes
function limpiar(txt) {
  return String(txt || '').trim().replace(/\s+/g, ' ');
}

// Valida los datos del formulario de registro.
// Devuelve { valido, errores: {campo: mensaje}, datos: {...limpios} }
function validarRegistro(body) {
  const errores = {};

  const nombres = limpiar(body.nombres);
  const apellidos = limpiar(body.apellidos);
  const whatsapp = String(body.whatsapp || '').trim();
  const correo = limpiar(body.correo).toLowerCase();
  const direccion = limpiar(body.direccion);

  // Nombres: obligatorio, solo letras, al menos 2 palabras (dos nombres)
  if (!nombres) {
    errores.nombres = 'Los nombres son obligatorios.';
  } else if (!RE_LETRAS.test(nombres)) {
    errores.nombres = 'Los nombres solo pueden tener letras (sin números ni símbolos).';
  } else if (nombres.split(' ').length < 2) {
    errores.nombres = 'Escribe tus dos nombres.';
  }

  // Apellidos: obligatorio, solo letras, al menos 2 palabras
  if (!apellidos) {
    errores.apellidos = 'Los apellidos son obligatorios.';
  } else if (!RE_LETRAS.test(apellidos)) {
    errores.apellidos = 'Los apellidos solo pueden tener letras (sin números ni símbolos).';
  } else if (apellidos.split(' ').length < 2) {
    errores.apellidos = 'Escribe tus dos apellidos.';
  }

  // WhatsApp: obligatorio, SOLO dígitos, longitud razonable
  if (!whatsapp) {
    errores.whatsapp = 'El número de WhatsApp es obligatorio.';
  } else if (!/^\d+$/.test(whatsapp)) {
    errores.whatsapp = 'El WhatsApp solo puede tener números (con código de país, sin espacios ni signos).';
  } else if (whatsapp.length < 8 || whatsapp.length > 15) {
    errores.whatsapp = 'El WhatsApp debe tener entre 8 y 15 dígitos.';
  }

  // Correo: obligatorio, formato válido
  if (!correo) {
    errores.correo = 'El correo es obligatorio.';
  } else if (!RE_CORREO.test(correo)) {
    errores.correo = 'Escribe un correo válido (ejemplo: nombre@correo.com).';
  }

  // Dirección: obligatoria, sin caracteres peligrosos
  if (!direccion) {
    errores.direccion = 'La dirección es obligatoria.';
  } else if (RE_DIRECCION_PELIGROSA.test(direccion)) {
    errores.direccion = 'La dirección tiene caracteres no permitidos (< > { } [ ] | \\ ` ^ ~).';
  } else if (direccion.length < 5) {
    errores.direccion = 'La dirección es demasiado corta.';
  }

  const valido = Object.keys(errores).length === 0;
  return {
    valido,
    errores,
    datos: { nombres, apellidos, whatsapp, correo, direccion },
  };
}

module.exports = { validarRegistro, limpiar };
