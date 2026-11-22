import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function localStorage(directory) {
  const media = join(directory,"media");
  await mkdir(media,{recursive:true});
  const db = new DatabaseSync(join(directory,"tienda.sqlite"));
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cms_entries'").get()) {
      db.exec(await readFile(new URL("../drizzle/0000_contenido_tienda.sql",import.meta.url),"utf8"));
    }
    db.exec("COMMIT");
  } catch(error) { db.exec("ROLLBACK"); throw error; }
  return {
    DB: { prepare(sql) { const query=db.prepare(sql);
      const bind=(...args)=>({bind,first:async()=>query.get(...args),all:async()=>({results:query.all(...args)})});
      return bind();
    }},
    BUCKET: {
      async put(key, bytes) { await writeFile(join(media,key),bytes); },
      async get(key) { try { return {body:await readFile(join(media,key))}; } catch(e) { if(e.code==="ENOENT")return null; throw e; } },
    },
  };
}
