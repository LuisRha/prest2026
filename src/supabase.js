const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('\n[ERROR] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el archivo .env\n');
  process.exit(1);
}

// Cliente con service_role: acceso completo desde el servidor.
// NUNCA se expone al navegador.
const supabase = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = supabase;
