// backend/src/app.js
import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

// Si tenés estos módulos, dejalos. Si no, comentá la línea y listo:
import { config as configCors } from "./config/cors.config.js";
import { config as configJson } from "./config/json.config.js";
import { connectDB } from "./config/mongoose.config.js";
import { config as configStatic } from "./config/static.config.js";

// Routers
import inquiryRouter from "./routes/inquiry.router.js";
import institutionRouter from "./routes/institution.router.js";
import productRouter from "./routes/product.router.js";
import sliderRouter from "./routes/slider.router.js";

// __dirname / __filename en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- App ---------- */
const app = express();

/* ---------- Middlewares base ---------- */
if (configCors) configCors(app);
app.use(express.json({ limit: "2mb" }));
if (configJson) configJson(app);

/* ---------- Healthcheck (sin depender de DB) ---------- */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "backend",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/* ---------- Conexión DB perezosa ---------- */
let __dbReady = false;

async function ensureDB() {
  if (__dbReady) return;

  if (!process.env.MONGODB_URI) {
    console.warn("[DB] MONGODB_URI no está definida. Saltando conexión.");
    // Marcamos ready para no intentar reconectar en cada request;
    // las rutas que requieran DB validan explícitamente y responden 503.
    __dbReady = false;
    return;
  }

  try {
    if (connectDB) {
      await connectDB();
      __dbReady = true;
      console.log("[DB] Conectada.");
    } else {
      console.warn("[DB] connectDB no definido.");
    }
  } catch (err) {
    console.error("[DB] Error conectando:", err?.message || err);
    __dbReady = false;
  }
}

async function requireDB(_req, res, next) {
  await ensureDB();

  if (!process.env.MONGODB_URI) {
    return res
      .status(503)
      .json({ error: "DB no configurada (falta MONGODB_URI)" });
  }
  if (!__dbReady || mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DB no disponible" });
  }
  next();
}

/* ---------- Endpoints de diagnóstico (DB/colecciones) ---------- */
// Nota: intentan usar la conexión si existe; no la fuerzan.
// Si querés que intenten conectar, descomentá: // await ensureDB();
app.get("/api/debug/db", async (_req, res) => {
  try {
    const conn = mongoose.connection;
    const dbName = conn?.name;
    const host = conn?.host;
    const ready = conn?.readyState === 1;

    let colNames = [];
    let counts = {};

    if (ready) {
      const collections = await conn.db.listCollections().toArray();
      colNames = collections.map((c) => c.name);

      const toCount = [
        "products",
        "institutions",
        "producto",
        "productos",
        "Productos",
        "Product",
      ];
      for (const name of toCount) {
        try {
          counts[name] = await conn.db.collection(name).countDocuments();
        } catch {
          counts[name] = -1; // no existe
        }
      }
    }

    res.json({
      connected: ready,
      host,
      dbName,
      collections: colNames,
      counts,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lee crudo los primeros 5 documentos de la colección "products" (nativo, sin Mongoose)
app.get("/api/debug/products/raw", async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "DB no disponible" });
    }
    const rows = await mongoose.connection.db
      .collection("products")
      .find({})
      .limit(5)
      .toArray();
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Archivos estáticos centralizados ---------- */
if (configStatic) configStatic(app);

/* ---------- Rutas API (aplican requireDB cuando necesitan DB) ---------- */
app.use(
  "/api/inquiries",
  inquiryRouter ? [requireDB, inquiryRouter] : (_req, res) => res.sendStatus(501)
);
app.use(
  "/api/institutions",
  institutionRouter ? [requireDB, institutionRouter] : (_req, res) => res.sendStatus(501)
);
app.use(
  "/api/products",
  productRouter ? [requireDB, productRouter] : (_req, res) => res.sendStatus(501)
);
app.use(
  "/api/sliders",
  sliderRouter ? [requireDB, sliderRouter] : (_req, res) => res.sendStatus(501)
);

/* ---------- Server local (solo dev) ---------- */
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}`);
  });
}

export default app;
