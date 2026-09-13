require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const supabase = require('./supabase');
const {
  formatoDinero,
  calcularPrestamo,
  estadoVencimiento,
  situacionPrestamo,
  etiquetaSituacion,
  sumarDias,
  linkWhatsApp,
  mensajeRecordatorio,
} = require('./utils');
const { validarRegistro } = require('./validaciones');
const SupabaseStore = require('./sessionStore')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Configuración de vistas y middlewares
// ============================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// En producción (Vercel, Render, etc.) la app corre detrás de un proxy HTTPS.
// Esto permite que las cookies "secure" funcionen correctamente.
const enProduccion = process.env.NODE_ENV === 'production';
if (enProduccion) {
  app.set('trust proxy', 1);
}

app.use(
  session({
    name: 'prest.sid',
    secret: process.env.SESSION_SECRET || 'secreto-por-defecto',
    resave: false,
    saveUninitialized: false,
    // Sesiones guardadas en Supabase (persisten en serverless/Vercel)
    store: new SupabaseStore({ ttlMs: 1000 * 60 * 60 * 8 }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
      httpOnly: true,            // la cookie no es accesible desde JS (anti-XSS)
      sameSite: 'lax',           // mitiga CSRF
      secure: enProduccion,      // solo por HTTPS en producción
    },
  })
);

// Variables disponibles en todas las vistas
app.use((req, res, next) => {
  res.locals.formatoDinero = formatoDinero;
  res.locals.sesion = req.session.admin || null;
  next();
});

// ============================================
// Autenticación (Opción A: usuario + contraseña del .env)
// ============================================
const ADMIN_USUARIO = process.env.ADMIN_USUARIO || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

function requiereLogin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/login');
}

// Comparación en tiempo constante (evita ataques de medición de tiempo)
function comparaSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

app.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  const okUsuario = comparaSeguro(usuario || '', ADMIN_USUARIO);
  const okPassword = comparaSeguro(password || '', ADMIN_PASSWORD);
  if (okUsuario && okPassword) {
    req.session.admin = { usuario: ADMIN_USUARIO };
    return res.redirect('/');
  }
  res.render('login', { error: 'Usuario o contraseña incorrectos.' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ============================================
// Dashboard (con alertas de vencimiento)
// ============================================
app.get('/', requiereLogin, async (req, res, next) => {
  try {
    const { data: prestamos, error } = await supabase
      .from('prestamos')
      .select('*, clientes(*)')
      .eq('estado', 'activo')
      .order('fecha_caducidad', { ascending: true });

    if (error) throw error;

    const { count: totalClientes } = await supabase
      .from('clientes')
      .select('*', { count: 'exact', head: true });

    const items = (prestamos || []).map((p) => {
      const calculo = calcularPrestamo(p);
      const estado = estadoVencimiento(p.fecha_caducidad);
      const cliente = p.clientes || {};
      const mensaje = mensajeRecordatorio(cliente, p, calculo, estado);
      const wa = linkWhatsApp(cliente.telefono, mensaje);
      return { ...p, cliente, calculo, venc: estado, wa };
    });

    const vencidos = items.filter((i) => i.venc.vencido);
    const porVencer = items.filter((i) => i.venc.porVencer && !i.venc.vencido);

    let capitalPrestado = 0;
    let totalPorCobrar = 0;
    items.forEach((i) => {
      capitalPrestado += i.calculo.monto;
      totalPorCobrar += i.calculo.totalAPagar;
    });

    res.render('dashboard', {
      vencidos,
      porVencer,
      totalActivos: items.length,
      totalClientes: totalClientes || 0,
      capitalPrestado,
      totalPorCobrar,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// CLIENTES
// ============================================
app.get('/clientes', requiereLogin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) throw error;
    res.render('clientes/lista', { clientes: data || [] });
  } catch (err) {
    next(err);
  }
});

app.get('/clientes/nuevo', requiereLogin, (req, res) => {
  res.render('clientes/form', { cliente: null, error: null });
});

app.post('/clientes/nuevo', requiereLogin, async (req, res, next) => {
  try {
    const { nombre, telefono, direccion, notas } = req.body;
    if (!nombre || !telefono) {
      return res.render('clientes/form', {
        cliente: req.body,
        error: 'El nombre y el teléfono son obligatorios.',
      });
    }
    const { error } = await supabase
      .from('clientes')
      .insert([{ nombre, telefono, direccion: direccion || null, notas: notas || null }]);
    if (error) throw error;
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

app.get('/clientes/:id/editar', requiereLogin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.render('clientes/form', { cliente: data, error: null });
  } catch (err) {
    next(err);
  }
});

app.post('/clientes/:id/editar', requiereLogin, async (req, res, next) => {
  try {
    const { nombre, telefono, direccion, notas } = req.body;
    if (!nombre || !telefono) {
      return res.render('clientes/form', {
        cliente: { ...req.body, id: req.params.id },
        error: 'El nombre y el teléfono son obligatorios.',
      });
    }
    const { error } = await supabase
      .from('clientes')
      .update({ nombre, telefono, direccion: direccion || null, notas: notas || null })
      .eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

app.post('/clientes/:id/eliminar', requiereLogin, async (req, res, next) => {
  try {
    const { error } = await supabase.from('clientes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

// Detalle de un cliente con sus préstamos
app.get('/clientes/:id', requiereLogin, async (req, res, next) => {
  try {
    const { data: cliente, error: e1 } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (e1) throw e1;

    const { data: prestamos, error: e2 } = await supabase
      .from('prestamos')
      .select('*')
      .eq('cliente_id', req.params.id)
      .order('fecha_caducidad', { ascending: true });
    if (e2) throw e2;

    const items = (prestamos || []).map((p) => {
      const calculo = calcularPrestamo(p);
      const estado = estadoVencimiento(p.fecha_caducidad);
      const mensaje = mensajeRecordatorio(cliente, p, calculo, estado);
      const wa = linkWhatsApp(cliente.telefono, mensaje);
      return { ...p, calculo, venc: estado, wa };
    });

    res.render('clientes/detalle', { cliente, prestamos: items });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PRÉSTAMOS
// ============================================
app.get('/prestamos', requiereLogin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('prestamos')
      .select('*, clientes(*)')
      .order('fecha_caducidad', { ascending: true });
    if (error) throw error;

    const items = (data || []).map((p) => {
      const calculo = calcularPrestamo(p);
      const estado = estadoVencimiento(p.fecha_caducidad);
      const cliente = p.clientes || {};
      const mensaje = mensajeRecordatorio(cliente, p, calculo, estado);
      const wa = linkWhatsApp(cliente.telefono, mensaje);
      return { ...p, cliente, calculo, venc: estado, wa };
    });

    res.render('prestamos/lista', { prestamos: items });
  } catch (err) {
    next(err);
  }
});

app.get('/prestamos/nuevo', requiereLogin, async (req, res, next) => {
  try {
    const { data: clientes, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) throw error;
    const hoy = new Date().toISOString().slice(0, 10);
    res.render('prestamos/form', {
      prestamo: null,
      clientes: clientes || [],
      clientePreseleccionado: req.query.cliente || null,
      hoy,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// Calcula la fecha de caducidad según el modo elegido (días o fecha directa)
function resolverCaducidad(body) {
  const fechaInicio = body.fecha_inicio || new Date().toISOString().slice(0, 10);
  let fechaCaducidad;
  let dias;

  if (body.modo_plazo === 'fecha' && body.fecha_caducidad) {
    // El usuario puso la fecha exacta
    fechaCaducidad = body.fecha_caducidad;
  } else {
    // El usuario puso los días
    dias = Number(body.dias) || 1;
    fechaCaducidad = sumarDias(fechaInicio, dias);
  }
  return { fechaInicio, fechaCaducidad };
}

app.post('/prestamos/nuevo', requiereLogin, async (req, res, next) => {
  try {
    const { cliente_id, monto, interes_mensual, mora_diaria, notas } = req.body;
    const { fechaInicio, fechaCaducidad } = resolverCaducidad(req.body);

    const { error } = await supabase.from('prestamos').insert([
      {
        cliente_id,
        monto: Number(monto),
        interes_mensual: Number(interes_mensual),
        mora_diaria: Number(mora_diaria) || 0,
        fecha_inicio: fechaInicio,
        fecha_caducidad: fechaCaducidad,
        estado: 'activo',
        notas: notas || null,
      },
    ]);
    if (error) throw error;
    res.redirect('/prestamos');
  } catch (err) {
    next(err);
  }
});

app.get('/prestamos/:id/editar', requiereLogin, async (req, res, next) => {
  try {
    const { data: prestamo, error } = await supabase
      .from('prestamos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    const { data: clientes } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true });

    const hoy = new Date().toISOString().slice(0, 10);
    res.render('prestamos/form', {
      prestamo,
      clientes: clientes || [],
      clientePreseleccionado: prestamo.cliente_id,
      hoy,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/prestamos/:id/editar', requiereLogin, async (req, res, next) => {
  try {
    const { cliente_id, monto, interes_mensual, mora_diaria, estado, notas } = req.body;
    const { fechaInicio, fechaCaducidad } = resolverCaducidad(req.body);

    const { error } = await supabase
      .from('prestamos')
      .update({
        cliente_id,
        monto: Number(monto),
        interes_mensual: Number(interes_mensual),
        mora_diaria: Number(mora_diaria) || 0,
        fecha_inicio: fechaInicio,
        fecha_caducidad: fechaCaducidad,
        estado: estado || 'activo',
        notas: notas || null,
      })
      .eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/prestamos');
  } catch (err) {
    next(err);
  }
});

app.post('/prestamos/:id/estado', requiereLogin, async (req, res, next) => {
  try {
    const { estado } = req.body;
    const { error } = await supabase
      .from('prestamos')
      .update({ estado })
      .eq('id', req.params.id);
    if (error) throw error;
    res.redirect(req.get('referer') || '/prestamos');
  } catch (err) {
    next(err);
  }
});

app.post('/prestamos/:id/eliminar', requiereLogin, async (req, res, next) => {
  try {
    const { error } = await supabase.from('prestamos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/prestamos');
  } catch (err) {
    next(err);
  }
});

// ============================================
// LINKS DE REGISTRO (panel admin)
// Cada link es único y para un solo cliente (un solo uso).
// ============================================
app.get('/links', requiereLogin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('registro_links')
      .select('*, clientes(id, nombre)')
      .order('creado_en', { ascending: false });
    if (error) throw error;

    const base = `${req.protocol}://${req.get('host')}`;
    const links = (data || []).map((l) => ({
      ...l,
      url: `${base}/registro/${l.token}`,
    }));
    res.render('links/lista', { links });
  } catch (err) {
    next(err);
  }
});

app.post('/links/nuevo', requiereLogin, async (req, res, next) => {
  try {
    const etiqueta = (req.body.etiqueta || '').trim() || null;
    // Token único imposible de adivinar
    const token = crypto.randomBytes(24).toString('hex');
    const { error } = await supabase
      .from('registro_links')
      .insert([{ token, etiqueta, usado: false }]);
    if (error) throw error;
    res.redirect('/links');
  } catch (err) {
    next(err);
  }
});

app.post('/links/:id/eliminar', requiereLogin, async (req, res, next) => {
  try {
    const { error } = await supabase.from('registro_links').delete().eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/links');
  } catch (err) {
    next(err);
  }
});

// ============================================
// REGISTRO PÚBLICO (sin login) — la persona abre su link
// ============================================
async function buscarLinkValido(token) {
  const { data, error } = await supabase
    .from('registro_links')
    .select('*')
    .eq('token', token)
    .single();
  if (error) return null;
  return data;
}

app.get('/registro/:token', async (req, res) => {
  const link = await buscarLinkValido(req.params.token);
  if (!link) {
    return res.status(404).render('registro/invalido', {
      motivo: 'Este link no es válido.',
    });
  }
  if (link.usado) {
    return res.status(410).render('registro/invalido', {
      motivo: 'Este link ya fue utilizado.',
    });
  }
  res.render('registro/form', {
    token: req.params.token,
    errores: {},
    datos: {},
  });
});

app.post('/registro/:token', async (req, res, next) => {
  try {
    const link = await buscarLinkValido(req.params.token);
    if (!link) {
      return res.status(404).render('registro/invalido', { motivo: 'Este link no es válido.' });
    }
    if (link.usado) {
      return res.status(410).render('registro/invalido', { motivo: 'Este link ya fue utilizado.' });
    }

    // Validación en el servidor (seguridad real)
    const { valido, errores, datos } = validarRegistro(req.body);
    if (!valido) {
      return res.status(400).render('registro/form', {
        token: req.params.token,
        errores,
        datos,
      });
    }

    // Crear el cliente. Llenamos nombre (combinado) para compatibilidad.
    const nombreCompleto = `${datos.nombres} ${datos.apellidos}`;
    const { data: cliente, error: e1 } = await supabase
      .from('clientes')
      .insert([
        {
          nombre: nombreCompleto,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          telefono: datos.whatsapp,
          correo: datos.correo,
          direccion: datos.direccion,
        },
      ])
      .select()
      .single();
    if (e1) throw e1;

    // Marcar el link como usado y ligarlo al cliente
    const { error: e2 } = await supabase
      .from('registro_links')
      .update({ usado: true, usado_en: new Date().toISOString(), cliente_id: cliente.id })
      .eq('id', link.id);
    if (e2) throw e2;

    res.render('registro/gracias', { nombres: datos.nombres });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Manejo de errores
// ============================================
app.use((req, res) => {
  res.status(404).render('error', { mensaje: 'Página no encontrada (404).' });
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message || err);
  // En producción no mostramos el detalle técnico del error al usuario.
  const mensaje = enProduccion
    ? 'Ocurrió un error. Intenta de nuevo.'
    : 'Ocurrió un error: ' + (err.message || 'error desconocido');
  res.status(500).render('error', { mensaje });
});

// Avisos de seguridad al arrancar
function avisosSeguridad() {
  const avisos = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('cambia-esto')) {
    avisos.push('SESSION_SECRET tiene el valor por defecto. Cámbialo por una frase larga y única.');
  }
  if (ADMIN_PASSWORD === 'admin' || ADMIN_PASSWORD === 'Prestamos2026') {
    avisos.push('La contraseña de admin es la de ejemplo. Cámbiala en el .env antes de publicar.');
  }
  if (enProduccion && avisos.length) {
    console.warn('\n[SEGURIDAD] Revisa lo siguiente antes de exponer la app a internet:');
    avisos.forEach((a) => console.warn('  - ' + a));
    console.warn('');
  }
}

// Solo levantamos el servidor cuando se ejecuta directamente (entorno local).
// En Vercel (serverless) se importa la app y NO se llama a listen().
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✅ App de préstamos corriendo en: http://localhost:${PORT}`);
    console.log(`   Usuario admin: ${ADMIN_USUARIO}`);
    console.log(`   (Puedes cambiar usuario/contraseña en el archivo .env)\n`);
    avisosSeguridad();
  });
}

// Exportamos la app para el entorno serverless (Vercel).
module.exports = app;
