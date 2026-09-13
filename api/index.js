// Punto de entrada para Vercel (serverless).
// Importa la app de Express ya configurada y la expone como función.
const app = require('../src/server');

module.exports = app;
