const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Indica si faltan variables (para mostrar un mensaje claro en vez de crashear).
const configOk = Boolean(url && serviceKey);

if (!configOk) {
  console.error(
    '[ERROR] Faltan variables de entorno SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
      'Configúralas en Vercel (Settings -> Environment Variables) y haz Redeploy.'
  );
}

// Creamos el cliente solo si hay configuración. Si no, queda null y las rutas
// mostrarán un aviso claro (la función NO se cae en seco).
const supabase = configOk
  ? createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

module.exports = { supabase, configOk };
