// ============================================
// Script para crear (o actualizar) el usuario ADMIN en la base de datos.
// El admin inicia sesión con CORREO + contraseña.
// Uso:
//   node src/scripts/crearAdmin.js "<correo>" "<contraseña>" "<nombre>" "<whatsapp>"
// Ejemplo:
//   node src/scripts/crearAdmin.js luis@correo.com MiClaveFuerte Luis 593987654321
// ============================================
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { supabase, configOk } = require('../supabase');

async function main() {
  if (!configOk) {
    console.error('Faltan variables de Supabase en el .env');
    process.exit(1);
  }

  const correo = String(process.argv[2] || '').trim().toLowerCase();
  const password = process.argv[3];
  const nombre = process.argv[4] || 'Administrador';
  const whatsapp = String(process.argv[5] || '').replace(/\D/g, '') || null;

  if (!correo || !password) {
    console.error('Uso: node src/scripts/crearAdmin.js "<correo>" "<contraseña>" "<nombre>" "<whatsapp>"');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 10);

  // ¿Ya existe por correo?
  const { data: existente } = await supabase
    .from('clientes')
    .select('id')
    .eq('correo', correo)
    .maybeSingle();

  if (existente) {
    const { error } = await supabase
      .from('clientes')
      .update({ password_hash, rol: 'admin', nombre, nombres: nombre })
      .eq('id', existente.id);
    if (error) throw error;
    console.log(`✅ Admin actualizado (correo ${correo}).`);
  } else {
    const registro = {
      nombre,
      nombres: nombre,
      apellidos: 'Admin',
      correo,
      rol: 'admin',
      password_hash,
    };
    if (whatsapp) registro.telefono = whatsapp;
    const { error } = await supabase.from('clientes').insert([registro]);
    if (error) throw error;
    console.log(`✅ Admin creado (correo ${correo}).`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
