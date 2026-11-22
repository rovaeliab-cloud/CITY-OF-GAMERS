# CITY OF GAMERS

Tienda de videojuegos digitales para PS4 y PS5 con panel de administración. Incluye el catálogo inicial de 447 videojuegos y 2.255 variantes, los seis banners del carrusel en dos resoluciones, los seis originales PNG y el código del sitio publicado.

**[Abrir la tienda](https://city-of-gamers-co.richhero2.chatgpt.site) · [Abrir ADMIN](https://city-of-gamers-co.richhero2.chatgpt.site/admin)**

## Administrar la tienda publicada

1. Entra en la tienda e inicia sesión con tu cuenta de ChatGPT. El botón **ADMIN** aparece junto a los controles de la cabecera para los tres correos autorizados.
2. En **Catálogo**, busca un juego y pulsa **Editar**, o usa **Agregar videojuego**. Puedes modificar la descripción, portada, galería, plataforma, tipo de cuenta, edición, disponibilidad, precio, precio anterior, etiquetas y requisitos. Las imágenes admiten URL HTTPS o archivos de hasta 4 MB. **Eliminar videojuego** pide confirmación.
3. En **Carrusel**, agrega o quita banners y usa **Subir posición** o **Bajar posición** para ordenar las imágenes. En **Apariencia**, cambia el fondo, los textos y las secciones visibles. En **Contacto**, escribe el número de WhatsApp con indicativo de país.
4. Pulsa **Guardar videojuego** o **Guardar cambios**. La tienda usa los datos guardados en la siguiente carga y las pestañas que están abiertas comprueban las novedades cada seis segundos. Si otra persona editó la misma ficha, recarga los datos antes de volver a guardar.

| Cuenta con modo ADMIN |
| --- |
| juanjoseortegaparraga6@gmail.com |
| rovaeliab@gmail.com |
| cityofgamerso@gmail.com |

La aplicación comprueba el rol en el servidor al abrir el panel y en cada petición de administración. En la tienda publicada, Sites verifica la identidad. El nombre de perfil se usa al preparar la consulta de compra por WhatsApp.

## Llevar la copia a GitHub y Vercel

1. Descomprime el ZIP. Sube su contenido a la raíz de un repositorio de GitHub, incluidas las carpetas ocultas del proyecto. `package.json` y `vercel.json` deben quedar en la raíz.
2. Importa el repositorio en Vercel. El archivo `vercel.json` configura el comando `npm run build`, el directorio `public` y las rutas de la aplicación. Usa Node.js 24.
3. Crea una base de datos D1 y un bucket R2 de tu propiedad en Cloudflare. En la consola SQL de la base nueva, ejecuta el contenido de `drizzle/0000_contenido_tienda.sql` una sola vez. El catálogo inicial ya está incluido. D1 conserva las ediciones y R2 conserva las imágenes que subas al panel.
4. Para el acceso de la copia de Vercel, crea un cliente **Aplicación web** en Google Auth Platform. Registra como URI de redirección el origen elegido seguido de `/auth/callback`. Para desarrollo local, añade también `http://localhost:3000/auth/callback`. Si tu proyecto de Google está en modo de prueba, habilita allí los usuarios que necesiten iniciar sesión.
5. Añade las variables de la tabla en **Environment Variables** de Vercel y despliega. Elige **Iniciar sesión** si Google te lo solicita. Una vez verificada la cuenta, la copia usa la misma lista de tres administradores.

| Variable | Valor para Vercel |
| --- | --- |
| `APP_ORIGIN` | Tu dominio HTTPS de producción, sin ruta ni barra final. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credenciales del cliente web de Google. |
| `SESSION_SECRET` | Una clave aleatoria de al menos 32 caracteres, guardada en el servidor. |
| `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID` | Identificadores de tu cuenta de Cloudflare y de la base D1. |
| `CF_R2_BUCKET` | Nombre del bucket R2 que usará la copia. |
| `CF_API_TOKEN` | Token de servidor de esa cuenta con lectura y escritura para D1 y los objetos R2 de la tienda. |

Puedes generar el secreto de sesión en tu equipo con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Las credenciales se configuran en el servicio de destino. La copia en Vercel usa su propia base y su propio almacenamiento. Los cambios posteriores que guardes en un alojamiento pertenecen a ese alojamiento.

[Importar proyecto en Vercel](https://vercel.com/new) · [Configurar Vercel](https://vercel.com/docs/project-configuration/vercel-json) · [Configurar el acceso de Google](https://developers.google.com/identity/openid-connect/openid-connect) · [D1](https://developers.cloudflare.com/d1/) · [R2](https://developers.cloudflare.com/r2/)

## Ejecutar y probar en tu equipo

Instala Node.js 24. Estos comandos compilan el proyecto y ejecutan las pruebas del CMS con datos temporales.

```sh
npm run build
npm test
```

Para usar el panel en tu equipo, copia `.env.example` a `.env.local`, fija `APP_ORIGIN=http://localhost:3000` y completa las credenciales de Google y `SESSION_SECRET`. Ejecuta `npm start` y abre **http://localhost:3000**. El servidor local guarda los cambios en SQLite y las imágenes en `.city-data/`. Compila de nuevo después de editar los archivos fuente.

## Contenido del ZIP

| Ruta | Contenido |
| --- | --- |
| `dist/` | Portada, catálogo, filtros, carrito, perfil, carrusel, panel ADMIN, estilos y archivos WebP. |
| `dist/server/index.js` | Tienda compilada, lista para el adaptador de servidor. |
| `worker/index.js`, `worker/cms.js`, `worker/defaults.json` | Lógica de la tienda, roles, validaciones, cambios de contenido y valores iniciales. |
| `drizzle/` | Migración SQL y metadatos de las tablas del CMS. |
| `scripts/` | Compilación, pruebas de permisos y edición, arranque local. |
| `api/`, `lib/`, `vercel.json`, `public/` | Adaptador para Vercel, acceso de Google, conexiones de almacenamiento y rutas. |
| `originales/banners/` | Seis banners originales en PNG. |
| `.openai/`, `.env.example` | Identidad del proyecto de Sites y ejemplo de configuración para el despliegue externo. |

Las carátulas iniciales de los juegos conservan las direcciones externas del catálogo de origen. Las imágenes nuevas que subas desde ADMIN se sirven desde el almacenamiento de la tienda.

Código de la versión publicada en Sites: `ba80a90a8913f1c65bb5c48d346e2e938447aa89`.
