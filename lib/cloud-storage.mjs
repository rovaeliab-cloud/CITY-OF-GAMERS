export function cloudStorage(env, transport = fetch) {
  const fields = ["CF_ACCOUNT_ID","CF_D1_DATABASE_ID","CF_R2_BUCKET","CF_API_TOKEN"];
  if (fields.some(key => !env[key])) throw Error("Falta la configuración de almacenamiento.");
  const account = "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(env.CF_ACCOUNT_ID);
  const headers = {Authorization:"Bearer " + env.CF_API_TOKEN};
  const d1Url = account + "/d1/database/" + encodeURIComponent(env.CF_D1_DATABASE_ID) + "/query";
  const objectUrl = key => account + "/r2/buckets/" + encodeURIComponent(env.CF_R2_BUCKET) + "/objects/" + encodeURIComponent(key);
  return {
    DB: { prepare(sql) {
      const bind = (...params) => {
        async function query() {
          const response = await transport(d1Url,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({sql,params})});
          if (!response.ok) throw Error("No se pudo consultar D1.");
          const body = await response.json();
          if (!body.success || !body.result?.[0]?.success) throw Error("Revisa la migración de D1.");
          return body.result[0];
        }
        return {bind,all:query,first:async () => (await query()).results[0] || null};
      };
      return bind();
    }},
    BUCKET: {
      async put(key, bytes) {
        const response = await transport(objectUrl(key),{method:"PUT",headers:{...headers,"Content-Type":"application/octet-stream"},body:bytes});
        if (!response.ok) throw Error("No se pudo guardar la imagen en R2.");
      },
      async get(key) {
        const response = await transport(objectUrl(key),{headers});
        if (response.status === 404) return null;
        if (!response.ok) throw Error("No se pudo leer la imagen en R2.");
        return {body:response.body};
      },
    },
  };
}
