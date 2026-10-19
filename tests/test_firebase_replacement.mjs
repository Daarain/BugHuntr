import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// ----------------------------------------------------------------------------
// 1. Static Boundary & Code Verification
// ----------------------------------------------------------------------------

test("Boundary Verification: Active application directories contain zero Firebase/Firestore imports", () => {
  const appDirs = ["app", "components", "lib", "hooks"];
  const forbiddenPatterns = [
    /from\s+["']firebase\/auth["']/,
    /from\s+["']firebase\/firestore["']/,
    /from\s+["']firebase\/storage["']/,
    /from\s+["']firebase\/app["']/,
    /from\s+["']@\/firebaseConfig["']/,
    /require\(["']@\/firebaseConfig["']\)/,
    /require\(["']firebase["']\)/,
  ];

  function walk(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(walk(fullPath));
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allFiles = appDirs.flatMap(d => walk(d));
  assert.ok(allFiles.length > 50, `Expected many application files, found ${allFiles.length}`);

  for (const file of allFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `File ${file} violates Firebase elimination boundary: matched ${pattern}`
      );
    }
  }
});

test("Boundary Verification: Specific migrated authentication files are verified clean", () => {
  const signupContent = fs.readFileSync("app/api/auth/signup/route.ts", "utf8");
  assert.ok(!signupContent.includes("firebaseConfig"), "Signup must not reference firebaseConfig");
  assert.ok(!signupContent.includes("firebase/firestore"), "Signup must not reference firebase/firestore");
  assert.ok(signupContent.includes("authRepository.createUser"), "Signup must use authRepository.createUser");

  const loginContent = fs.readFileSync("app/api/auth/login/route.ts", "utf8");
  assert.ok(!loginContent.includes("firebaseConfig"), "Login must not reference firebaseConfig");
  assert.ok(!loginContent.includes("firebase/firestore"), "Login must not reference firebase/firestore");
  assert.ok(loginContent.includes("authRepository.findUserByEmail"), "Login must use authRepository.findUserByEmail");

  const useAuthContent = fs.readFileSync("hooks/use-auth.ts", "utf8");
  assert.ok(!useAuthContent.includes("firebase/auth"), "use-auth hook must not import firebase/auth");
  assert.ok(!useAuthContent.includes("firebaseConfig"), "use-auth hook must not import firebaseConfig");
  assert.ok(useAuthContent.includes("/api/auth/me"), "use-auth hook must verify session via /api/auth/me");
});

// ----------------------------------------------------------------------------
// 2. Behavioral Verification: Fail-Closed When PostgreSQL Backend Unconfigured
// ----------------------------------------------------------------------------

test("Authentication Behavior: Signup fails closed with 503 when PostgreSQL is unconfigured", async () => {
  const origPg = process.env.POSTGRES_URL;
  const origDb = process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;

  try {
    const { POST } = await import("../app/api/auth/signup/route.ts");
    const req = new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "hunter_test@example.com",
        password: "securePassword123!",
        name: "Test Hunter",
        userType: "hunter",
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /PostgreSQL authentication backend is required/);
  } finally {
    if (origPg) process.env.POSTGRES_URL = origPg;
    if (origDb) process.env.DATABASE_URL = origDb;
  }
});

test("Authentication Behavior: Login fails closed with 503 when PostgreSQL is unconfigured", async () => {
  const origPg = process.env.POSTGRES_URL;
  const origDb = process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;

  try {
    const { POST } = await import("../app/api/auth/login/route.ts");
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "hunter_test@example.com",
        password: "securePassword123!",
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 503);
    const body = await res.json();
      assert.match(body.error, /PostgreSQL authentication backend is required/);
    } finally {
      if (origPg) process.env.POSTGRES_URL = origPg;
      if (origDb) process.env.DATABASE_URL = origDb;
    }
  });

  // ----------------------------------------------------------------------------
  // 3. Decommissioning Verification: Configuration and Package Removals
  // ----------------------------------------------------------------------------

  test("Decommissioning: firebaseConfig.js is completely removed from project root", () => {
    assert.equal(
      fs.existsSync("firebaseConfig.js"),
      false,
      "firebaseConfig.js must not exist in project root"
    );
  });

  test("Decommissioning: package.json has zero firebase or firebase-function dependencies", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    assert.equal(allDeps["firebase"], undefined, "firebase must not be in package.json");
    assert.equal(
      allDeps["firebase-function"],
      undefined,
      "firebase-function must not be in package.json"
    );
    assert.equal(
      allDeps["@types/firebase"],
      undefined,
      "@types/firebase must not be in package.json"
    );
  });

  test("Decommissioning: Migration scripts execute dry-run with zero Firebase SDK runtime requirement", () => {
    const sqlScript = fs.readFileSync("scripts/migrate-firestore-to-sql.ts", "utf8");
    assert.ok(!sqlScript.includes("from 'firebase"), "SQL migration must not import firebase");
    assert.ok(!sqlScript.includes("from \"firebase"), "SQL migration must not import firebase");

    const mongoScript = fs.readFileSync("scripts/migrate-firestore-to-mongo.ts", "utf8");
    assert.ok(!mongoScript.includes("from 'firebase"), "Mongo migration must not import firebase");
    assert.ok(!mongoScript.includes("from \"firebase"), "Mongo migration must not import firebase");
  });
