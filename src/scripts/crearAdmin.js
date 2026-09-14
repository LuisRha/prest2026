// ============================================
// Script para crear (o actualizar) el usuario ADMIN en la base de datos.
// Uso:
//   node src/scripts/crearAdmin.js "<whatsapp>" "<contraseña>" "<nombre>"
// Ejemplo:
//   node src/scripts/crearAdmin.js 593987654321 MiClaveFuerte Luis
// ============================================
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { supabase, configOk } = require('../supabase');

async function main() {
  if (!configOk) {
    console.error('Faltan variables de Supabase en el .env');
    process.exit(1);
  }

  const whatsapp = String(process.argv[2] || '').replace(/\D/g, '');
  const password = process.argv[3];
  const nombre = process.argv[4] || 'Administrador';

  if (!whatsapp || !password) {
    console.error('Uso: node src/scripts/crearAdmin.js "<whatsapp>" "<contraseña>" "<nombre>"');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 10);

  // ¿Ya existe?
  const { data: existente } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefono', whatsapp)
    .maybeSingle();

  if (existente) {
    const { error } = await supabase
      .from('clientes')
      .update({ password_hash, rol: 'admin', nombre, nombres: nombre })
      .eq('id', existente.id);
    if (error) throw error;
    console.log(`✅ Admin actualizado (WhatsApp ${whatsapp}).`);
  } else {
    const { error } = await supabase.from('clientes').insert([
      {
        nombre,
        nombres: nombre,
        apellidos: 'Admin',
        telefono: whatsapp,
        rol: 'admin',
        password_hash,
      },
    ]);
    if (error) throw error;
    console.log(`✅ Admin creado (WhatsApp ${whatsapp}).`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
