# Sistema Personal de Préstamos

App web privada para administrar tus préstamos: clientes, montos, interés mensual editable, mora diaria, fechas de vencimiento, alertas y recordatorios por WhatsApp (manual/gratis). Incluye registro de clientes por link único.

Hecho con Node.js + Express + Supabase. Interfaz en español.

---

## Cómo iniciar la app

1. Abre una terminal en esta carpeta.
2. La primera vez, instala dependencias (ya hecho): `npm install`
3. Arranca la app: `npm start`
4. Abre en tu navegador: http://localhost:3000

Para detener la app: en la terminal presiona Ctrl + C.

---

## Entrar al panel (login)

- Usuario: `luis`
- Contraseña: `Prestamos2026`

Puedes cambiarlos en el archivo `.env` (ADMIN_USUARIO y ADMIN_PASSWORD). Reinicia la app después.

---

## Qué puedes hacer

- Inicio (Dashboard): resumen y alertas de préstamos vencidos y por vencer (aviso 3 días antes).
- Clientes: crear, ver, editar y eliminar (nombres, apellidos, WhatsApp, correo, dirección, notas).
- Préstamos: monto, interés mensual editable (%), mora diaria editable (%), plazo por días o por fecha exacta. Cálculo en vivo.
- Links de registro: link único de un solo uso por persona; ella se registra sola con datos validados.
- WhatsApp: botón que abre el chat con el mensaje ya escrito según la situación. Manual y gratis.

---

## Cómo se calcula

Interés normal (dentro del plazo), mes completo:
```
Interés del mes = monto x (% mensual / 100)
```

Mora (después de la caducidad), por día de atraso:
```
Mora = monto x (% mora diaria / 100) x días de atraso
Total a pagar = monto + interés del mes + mora
```

Ejemplo: 50 al 10% mensual, mora 1% diario, vencido hace 5 días
=> interés 5 + mora 2,50 => total 57,50 (sube cada día hasta marcar como pagado).

---

## Mensajes de WhatsApp por situación

- Con tiempo: recordatorio general.
- Por vencer (3 días o menos): aviso de que se acerca la fecha.
- Día de pago (vence hoy): aviso de que hoy toca pagar.
- Vencido: aviso de atraso con la mora incluida.

Se envían al número de WhatsApp registrado del cliente. Tú solo das enviar.

---

## Registro de clientes por link único

1. En el panel, entra a "Links registro" y genera un link (con etiqueta opcional).
2. Copia el link y envíaselo a la persona.
3. La persona abre el link y llena el formulario con validaciones estrictas:
   - Nombres y apellidos: solo letras, dos palabras cada uno.
   - WhatsApp: solo dígitos (8 a 15), con código de país.
   - Correo: formato válido.
   - Dirección: bloquea caracteres peligrosos.
4. Al registrarse, el cliente aparece en tu panel y el link queda usado (ya no sirve).

---

## Teléfono para WhatsApp

Guarda el teléfono con código de país y sin signos. Ejemplo Ecuador: 593987654321.

---

## Base de datos (Supabase)

Tablas: clientes, prestamos, registro_links. La configuración está en `.env` (URL y clave secreta).

Seguridad: el archivo `.env` contiene la clave service_role. No lo compartas ni lo subas a internet. Ya está protegido por `.gitignore`.

---

## Estructura del proyecto

```
PrestLuis2026/
  .env                  Configuración (Supabase + login) - PRIVADO
  .gitignore
  package.json
  public/css/estilos.css
  src/
    server.js           Servidor y rutas
    supabase.js         Conexión a Supabase
    utils.js            Cálculos y WhatsApp
    validaciones.js     Validaciones del registro público
    views/              Páginas (login, dashboard, clientes, préstamos, links, registro)
```

---

## Problemas comunes

- No abre la página: corre `npm start` y revisa que diga "corriendo en http://localhost:3000".
- No entra al login: revisa usuario/contraseña en `.env`.
- Error de base de datos: verifica que las tablas existan en Supabase y que la clave en `.env` sea la correcta.
