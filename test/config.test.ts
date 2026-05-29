import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const databaseEnvNames = [
  "DATABASE_URL",
  "POSTGRESQL_HOST",
  "POSTGRESQL_PORT",
  "POSTGRESQL_USERNAME",
  "POSTGRESQL_PASSWORD",
  "POSTGRESQL_DATABASE",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USERNAME",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
  "POSTGRES_URI",
  "POSTGRES_CONNECTION_STRING"
];

test("loadConfig uses DATABASE_URL when Zeabur components are unavailable", () => {
  withDatabaseEnv(
    {
      DATABASE_URL: "postgresql://manual.example/db",
      POSTGRES_URI: "postgresql://generated.example/db"
    },
    () => {
      const config = loadConfig();
      assert.equal(config.databaseUrl, "postgresql://manual.example/db");
      assert.equal(config.databaseConnectionSource, "DATABASE_URL");
    }
  );
});

test("loadConfig builds Zeabur component connection before DATABASE_URL or generated URI", () => {
  withDatabaseEnv(
    {
      DATABASE_URL: "postgresql://manual.example/db",
      POSTGRES_HOST: "postgresql-trotal.zeabur.internal",
      POSTGRES_PORT: "5432",
      POSTGRES_USERNAME: "root",
      POSTGRES_PASSWORD: "se cret",
      POSTGRES_DATABASE: "zeabur",
      POSTGRES_URI: "postgresql://generated.example/db"
    },
    () => {
      const config = loadConfig();
      assert.equal(
        config.databaseUrl,
        "postgresql://root:se%20cret@postgresql-trotal.zeabur.internal:5432/zeabur"
      );
      assert.equal(
        config.databaseConnectionSource,
        "POSTGRES_HOST+POSTGRES_USERNAME+POSTGRES_PASSWORD+POSTGRES_DATABASE"
      );
    }
  );
});

test("loadConfig prefers current POSTGRES variables over stale POSTGRESQL variables", () => {
  withDatabaseEnv(
    {
      POSTGRESQL_HOST: "service-old",
      POSTGRESQL_PORT: "5432",
      POSTGRES_HOST: "service-current",
      POSTGRES_PORT: "5432",
      POSTGRES_USERNAME: "root",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_DATABASE: "zeabur"
    },
    () => {
      const config = loadConfig();
      assert.equal(config.databaseUrl, "postgresql://root:secret@service-current:5432/zeabur");
      assert.equal(
        config.databaseConnectionSource,
        "POSTGRES_HOST+POSTGRES_USERNAME+POSTGRES_PASSWORD+POSTGRES_DATABASE"
      );
    }
  );
});

test("loadConfig falls back to generated PostgreSQL URI", () => {
  withDatabaseEnv(
    {
      POSTGRES_URI: "postgresql://generated.example/db"
    },
    () => {
      const config = loadConfig();
      assert.equal(config.databaseUrl, "postgresql://generated.example/db");
      assert.equal(config.databaseConnectionSource, "POSTGRES_URI");
    }
  );
});

function withDatabaseEnv(values: Record<string, string>, run: () => void): void {
  const previous = new Map<string, string | undefined>();

  for (const name of databaseEnvNames) {
    previous.set(name, process.env[name]);
    delete process.env[name];
  }

  Object.assign(process.env, values);

  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
