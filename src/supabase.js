const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  const msg =
    'Faltan variables de entorno: SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
    'Configúralas en el panel de Vercel (Settings → Environment Variables) y vuelve a desplegar (Redeploy).';
  console.error('[ERROR] ' + msg);
  // En serverless NO usamos process.exit (tumba la función). Lanzamos un error normal.
  throw new Error(msg);
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
