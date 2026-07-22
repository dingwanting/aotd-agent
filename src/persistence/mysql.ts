import mysql from "mysql2/promise";

import { loadEnv } from "../config/env.js";

let pool: mysql.Pool | null = null;

function buildPool(): mysql.Pool | null {
  const env = loadEnv();
  if (!env.mysqlAddress || !env.mysqlUsername || !env.mysqlPassword) {
    return null;
  }

  const [host, portString] = env.mysqlAddress.split(":");
  const port = Number(portString || "3306");

  return mysql.createPool({
    host,
    port,
    user: env.mysqlUsername,
    password: env.mysqlPassword,
    database: env.mysqlDatabase,
    connectionLimit: 5,
    charset: "utf8mb4",
  });
}

export function getMysqlPool(): mysql.Pool | null {
  if (!pool) {
    pool = buildPool();
  }
  return pool;
}

