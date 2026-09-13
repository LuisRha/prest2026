// ============================================
// Almacén de sesiones en Supabase (tabla "sesiones").
// Compatible con express-session. Necesario para Vercel/serverless,
// donde la memoria no persiste entre peticiones.
// ============================================
const supabase = require('./supabase');

module.exports = function (session) {
  const Store = session.Store;

  class SupabaseStore extends Store {
    constructor(options = {}) {
      super(options);
      // Duración por defecto si la sesión no trae cookie.maxAge (ms)
      this.ttlMs = options.ttlMs || 1000 * 60 * 60 * 8; // 8 horas
    }

    _expiraDesde(sess) {
      const maxAge = sess && sess.cookie && sess.cookie.maxAge;
      const ms = typeof maxAge === 'number' ? maxAge : this.ttlMs;
      return new Date(Date.now() + ms).toISOString();
    }

    // Leer sesión
    async get(sid, cb) {
      try {
        const { data, error } = await supabase
          .from('sesiones')
          .select('data, expira')
          .eq('sid', sid)
          .maybeSingle();
        if (error) throw error;
        if (!data) return cb(null, null);

        // ¿Expirada?
        if (new Date(data.expira).getTime() < Date.now()) {
          await this.destroy(sid, () => {});
          return cb(null, null);
        }
        return cb(null, data.data);
      } catch (err) {
        return cb(err);
      }
    }

    // Guardar / actualizar sesión
    async set(sid, sess, cb = () => {}) {
      try {
        const registro = {
          sid,
          data: sess,
          expira: this._expiraDesde(sess),
        };
        const { error } = await supabase
          .from('sesiones')
          .upsert(registro, { onConflict: 'sid' });
        if (error) throw error;
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }

    // Borrar sesión (logout / expiración)
    async destroy(sid, cb = () => {}) {
      try {
        const { error } = await supabase.from('sesiones').delete().eq('sid', sid);
        if (error) throw error;
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }

    // Renovar expiración (cuando el usuario sigue activo)
    async touch(sid, sess, cb = () => {}) {
      try {
        const { error } = await supabase
          .from('sesiones')
          .update({ expira: this._expiraDesde(sess) })
          .eq('sid', sid);
        if (error) throw error;
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }
  }

  return SupabaseStore;
};
