require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { supabase, configOk } = require('./supabase');
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

// Si faltan las variables de Supabase, mostramos un aviso claro en vez de
// crashear (útil al configurar Vercel). Se corta aquí antes de usar la sesión.
if (!configOk) {
  app.use((req, res) => {
    res
      .status(500)
      .send(
        '<h2>Falta configuración</h2>' +
          '<p>La app no encuentra las variables <b>SUPABASE_URL</b> y/o <b>SUPABASE_SERVICE_ROLE_KEY</b>.</p>' +
          '<p>Ve a Vercel → Settings → Environment Variables, agrégalas para <b>Production</b>, y haz <b>Redeploy</b>.</p>'
      );
  });
  module.exports = app;
  return;
}

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
  res.locals.usuario = req.session.usuario || null; // { id, nombre, rol }
  next();
});

// ============================================
// Autenticación por base de datos con roles (admin | cliente)
// Login único: según el rol, se dirige al panel admin o al portal cliente.
// El identificador de inicio de sesión es el WhatsApp (telefono).
// ============================================

// Normaliza a solo dígitos para comparar el WhatsApp de forma consistente
function soloDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

// Middleware: exige haber iniciado sesión (cualquier rol)
function requiereSesion(req, res, next) {
  if (req.session && req.session.usuario) return next();
  return res.redirect('/login');
}

// Middleware: exige rol admin
function requiereAdmin(req, res, next) {
  if (req.session && req.session.usuario && req.session.usuario.rol === 'admin') return next();
  if (req.session && req.session.usuario) return res.redirect('/cliente'); // es cliente
  return res.redirect('/login');
}

// Middleware: exige rol cliente
function requiereCliente(req, res, next) {
  if (req.session && req.session.usuario && req.session.usuario.rol === 'cliente') return next();
  if (req.session && req.session.usuario) return res.redirect('/'); // es admin
  return res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session.usuario) {
    return res.redirect(req.session.usuario.rol === 'admin' ? '/' : '/cliente');
  }
  res.render('login', { error: null });
});

app.post('/login', async (req, res, next) => {
  try {
    const correo = String(req.body.usuario || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!correo || !password) {
      return res.render('login', { error: 'Ingresa tu correo y contraseña.' });
    }

    // Buscar por correo
    const { data: cliente, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('correo', correo)
      .maybeSingle();
    if (error) throw error;

    if (!cliente || !cliente.password_hash) {
      return res.render('login', { error: 'Correo o contraseña incorrectos.' });
    }

    const ok = await bcrypt.compare(password, cliente.password_hash);
    if (!ok) {
      return res.render('login', { error: 'Correo o contraseña incorrectos.' });
    }

    req.session.usuario = {
      id: cliente.id,
      nombre: cliente.nombres || cliente.nombre || 'Usuario',
      rol: cliente.rol || 'cliente',
    };
    return res.redirect(req.session.usuario.rol === 'admin' ? '/' : '/cliente');
  } catch (err) {
    next(err);
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Alias para mantener compatibilidad con las rutas del admin ya escritas
const requiereLogin = requiereAdmin;

// ============================================
// CAMBIAR CONTRASEÑA (admin o cliente, su propia cuenta)
// ============================================
app.get('/password', requiereSesion, (req, res) => {
  res.render('password', { error: null, ok: false });
});

app.post('/password', requiereSesion, async (req, res, next) => {
  try {
    const actual = String(req.body.actual || '');
    const nueva = String(req.body.nueva || '');
    const nueva2 = String(req.body.nueva2 || '');

    if (!actual || !nueva) {
      return res.render('password', { error: 'Completa todos los campos.', ok: false });
    }
    if (nueva.length < 6) {
      return res.render('password', { error: 'La nueva contraseña debe tener al menos 6 caracteres.', ok: false });
    }
    if (nueva !== nueva2) {
      return res.render('password', { error: 'Las contraseñas nuevas no coinciden.', ok: false });
    }

    const { data: cliente, error } = await supabase
      .from('clientes')
      .select('id, password_hash')
      .eq('id', req.session.usuario.id)
      .single();
    if (error) throw error;

    const ok = await bcrypt.compare(actual, cliente.password_hash || '');
    if (!ok) {
      return res.render('password', { error: 'La contraseña actual es incorrecta.', ok: false });
    }

    const nuevoHash = await bcrypt.hash(nueva, 10);
    const { error: e2 } = await supabase
      .from('clientes')
      .update({ password_hash: nuevoHash })
      .eq('id', cliente.id);
    if (e2) throw e2;

    res.render('password', { error: null, ok: true });
  } catch (err) {
    next(err);
  }
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

    // ¿Ya existe un cliente con ese WhatsApp? (el telefono es único)
    const { data: existente } = await supabase
      .from('clientes')
      .select('id')
      .eq('telefono', datos.whatsapp)
      .maybeSingle();
    if (existente) {
      return res.status(400).render('registro/form', {
        token: req.params.token,
        errores: { whatsapp: 'Ya existe una cuenta con ese WhatsApp. Inicia sesión.' },
        datos,
      });
    }

    // Hash de la contraseña (nunca se guarda en texto plano)
    const passwordHash = await bcrypt.hash(datos.password, 10);

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
          password_hash: passwordHash,
          rol: 'cliente',
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
// PORTAL DEL CLIENTE (rol cliente)
// ============================================
app.get('/cliente', requiereCliente, async (req, res, next) => {
  try {
    const cid = req.session.usuario.id;

    const { data: cliente, error: e0 } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', cid)
      .single();
    if (e0) throw e0;

    // Solicitudes del cliente
    const { data: solicitudes, error: e1 } = await supabase
      .from('solicitudes')
      .select('*')
      .eq('cliente_id', cid)
      .order('creada_en', { ascending: false });
    if (e1) throw e1;

    // Préstamos del cliente
    const { data: prestamos, error: e2 } = await supabase
      .from('prestamos')
      .select('*')
      .eq('cliente_id', cid)
      .order('fecha_caducidad', { ascending: true });
    if (e2) throw e2;

    const prestamosCalc = (prestamos || []).map((p) => {
      const calculo = calcularPrestamo(p);
      const venc = estadoVencimiento(p.fecha_caducidad);
      return { ...p, calculo, venc };
    });

    res.render('cliente/inicio', {
      cliente,
      solicitudes: solicitudes || [],
      prestamos: prestamosCalc,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/cliente/solicitar', requiereCliente, (req, res) => {
  res.render('cliente/solicitar', { error: null, datos: {} });
});

app.post('/cliente/solicitar', requiereCliente, async (req, res, next) => {
  try {
    const monto = Number(req.body.monto);
    const dias = parseInt(req.body.dias, 10);
    const nota = (req.body.nota_cliente || '').trim() || null;

    if (!monto || monto <= 0 || !dias || dias <= 0) {
      return res.render('cliente/solicitar', {
        error: 'Ingresa un monto y una cantidad de días válidos.',
        datos: req.body,
      });
    }

    const { error } = await supabase.from('solicitudes').insert([
      {
        cliente_id: req.session.usuario.id,
        monto,
        dias,
        estado: 'pendiente',
        nota_cliente: nota,
      },
    ]);
    if (error) throw error;
    res.redirect('/cliente');
  } catch (err) {
    next(err);
  }
});

// ============================================
// SOLICITUDES (panel admin): aprobar / rechazar
// ============================================
app.get('/solicitudes', requiereAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('solicitudes')
      .select('*, clientes(id, nombre, telefono)')
      .order('creada_en', { ascending: false });
    if (error) throw error;
    res.render('solicitudes/lista', { solicitudes: data || [] });
  } catch (err) {
    next(err);
  }
});

// Muestra el formulario para aprobar (poner interés y mora)
app.get('/solicitudes/:id/aprobar', requiereAdmin, async (req, res, next) => {
  try {
    const { data: sol, error } = await supabase
      .from('solicitudes')
      .select('*, clientes(id, nombre, telefono)')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.render('solicitudes/aprobar', { sol, error: null });
  } catch (err) {
    next(err);
  }
});

// Procesa la aprobación: crea el préstamo real con interés/mora del admin
app.post('/solicitudes/:id/aprobar', requiereAdmin, async (req, res, next) => {
  try {
    const { data: sol, error: e0 } = await supabase
      .from('solicitudes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (e0) throw e0;
    if (sol.estado !== 'pendiente') {
      return res.redirect('/solicitudes');
    }

    const interesMensual = Number(req.body.interes_mensual) || 0;
    const moraDiaria = Number(req.body.mora_diaria) || 0;
    const fechaInicio = new Date().toISOString().slice(0, 10);
    const fechaCaducidad = sumarDias(fechaInicio, sol.dias);

    // Crear el préstamo real
    const { data: prestamo, error: e1 } = await supabase
      .from('prestamos')
      .insert([
        {
          cliente_id: sol.cliente_id,
          monto: Number(sol.monto),
          interes_mensual: interesMensual,
          mora_diaria: moraDiaria,
          fecha_inicio: fechaInicio,
          fecha_caducidad: fechaCaducidad,
          estado: 'activo',
          notas: 'Aprobado desde solicitud #' + sol.id,
        },
      ])
      .select()
      .single();
    if (e1) throw e1;

    // Marcar la solicitud como aprobada
    const { error: e2 } = await supabase
      .from('solicitudes')
      .update({
        estado: 'aprobada',
        prestamo_id: prestamo.id,
        resuelta_en: new Date().toISOString(),
      })
      .eq('id', sol.id);
    if (e2) throw e2;

    res.redirect('/solicitudes');
  } catch (err) {
    next(err);
  }
});

app.post('/solicitudes/:id/rechazar', requiereAdmin, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('solicitudes')
      .update({ estado: 'rechazada', resuelta_en: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/solicitudes');
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
  if (
    enProduccion &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('cambia-esto'))
  ) {
    console.warn('\n[SEGURIDAD] SESSION_SECRET tiene el valor por defecto. Cámbialo por una frase larga y única.\n');
  }
}

// Solo levantamos el servidor cuando se ejecuta directamente (entorno local).
// En Vercel (serverless) se importa la app y NO se llama a listen().
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✅ App de préstamos corriendo en: http://localhost:${PORT}`);
    console.log(`   Login: usa el WhatsApp y contraseña de un usuario de la tabla clientes.\n`);
    avisosSeguridad();
  });
}

// Exportamos la app para el entorno serverless (Vercel).
module.exports = app;
